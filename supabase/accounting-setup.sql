alter table public.item_transaksi
  add column if not exists hpp_satuan numeric;

alter table public.produk_hpp
  add column if not exists cabang_id uuid;

do $$
declare
  branch_count integer;
begin
  if exists (select 1 from public.produk_hpp where cabang_id is null) then
    select count(*) into branch_count from public.cabang;
    if branch_count <> 1 then
      raise exception 'Perubahan dibatalkan: HPP lama tidak memiliki cabang dan tabel cabang harus berisi tepat satu baris untuk migrasi otomatis.';
    end if;
    update public.produk_hpp
    set cabang_id = (select id from public.cabang limit 1)
    where cabang_id is null;
  end if;
end
$$;

alter table public.produk_hpp
  alter column cabang_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.produk_hpp'::regclass
      and conname = 'produk_hpp_cabang_id_fkey'
  ) then
    alter table public.produk_hpp
      add constraint produk_hpp_cabang_id_fkey
      foreign key (cabang_id) references public.cabang(id) on delete cascade;
  end if;
end
$$;

alter table public.produk_hpp
  drop constraint if exists produk_hpp_pkey;
alter table public.produk_hpp
  add constraint produk_hpp_pkey primary key (cabang_id, produk_id);

drop policy if exists produk_hpp_baca on public.produk_hpp;
create policy produk_hpp_baca
on public.produk_hpp for select
to authenticated
using (is_mgr() and cabang_ok(cabang_id));

drop policy if exists produk_hpp_tulis on public.produk_hpp;
create policy produk_hpp_tulis
on public.produk_hpp for all
to authenticated
using (is_mgr() and cabang_ok(cabang_id))
with check (is_mgr() and cabang_ok(cabang_id));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.item_transaksi'::regclass
      and conname = 'item_transaksi_hpp_satuan_check'
  ) then
    alter table public.item_transaksi
      add constraint item_transaksi_hpp_satuan_check
      check (hpp_satuan is null or hpp_satuan >= 0);
  end if;
end
$$;

create or replace function public.buat_transaksi(
  p_nama text,
  p_channel text,
  p_ongkir integer,
  p_payment text,
  p_items jsonb,
  p_cabang uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cab uuid;
  tid uuid;
  it jsonb;
  pr record;
  q int;
  tot int := 0;
begin
  if peran_saya() is null then raise exception 'Tidak punya akses'; end if;
  cab := case when is_mgr() then coalesce(p_cabang, cabang_saya()) else cabang_saya() end;
  if cab is null then raise exception 'Cabang belum dipilih'; end if;
  if p_channel is null or p_payment is null
    or p_channel not in ('outlet','shopee')
    or not (
      (p_channel = 'outlet' and p_payment in ('qris','cash'))
      or (p_channel = 'shopee' and p_payment = 'shopee_app')
    ) then
    raise exception 'Channel atau payment tidak valid';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pesanan kosong';
  end if;

  insert into transaksi (cabang_id, kasir_id, nama_pembeli, channel, ongkir, payment)
  values (cab, auth.uid(), p_nama, p_channel, coalesce(p_ongkir, 0), p_payment)
  returning id into tid;

  for it in select * from jsonb_array_elements(p_items) loop
    q := (it->>'qty')::int;
    if q is null or q <= 0 then raise exception 'Jumlah tidak valid'; end if;

    select produk.id,
           case when p_channel = 'shopee' then produk.harga_shopee else produk.harga_outlet end as harga,
           produk_hpp.hpp
    into pr
    from produk
    left join produk_hpp
      on produk_hpp.produk_id = produk.id
      and produk_hpp.cabang_id = cab
    where produk.id = (it->>'produk_id')::uuid
      and produk.aktif;

    if not found or pr.harga is null then raise exception 'Produk atau harga tidak tersedia'; end if;

    insert into item_transaksi (transaksi_id, produk_id, qty, harga_satuan, hpp_satuan)
    values (tid, pr.id, q, pr.harga, pr.hpp);
    tot := tot + q * pr.harga;
  end loop;

  update transaksi set total = tot where id = tid;
  return tid;
end
$function$;

grant execute on function public.buat_transaksi(text, text, integer, text, jsonb, uuid) to authenticated;

create or replace function public.laporan_laba_bulanan(
  p_cabang uuid,
  p_bulan date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_mulai date;
  v_berikutnya date;
  v_penjualan numeric := 0;
  v_hpp numeric := 0;
  v_hpp_kurang numeric := 0;
  v_laba_kotor numeric;
  v_alokasi_operasional numeric;
  v_laba_bersih numeric;
  v_pengeluaran_bulan numeric := 0;
  v_pengeluaran_sebelumnya numeric := 0;
  v_alokasi_sebelumnya numeric := 0;
  v_hpp_historis_kurang bigint := 0;
  v_saldo_awal numeric;
begin
  if auth.uid() is null or peran_saya() <> 'pemilik' then
    raise exception 'Hanya pemilik yang dapat melihat laporan laba';
  end if;
  if p_cabang is null or not cabang_ok(p_cabang) then
    raise exception 'Tidak punya akses ke cabang ini';
  end if;
  if p_bulan is null then raise exception 'Bulan laporan wajib dipilih'; end if;

  v_mulai := date_trunc('month', p_bulan)::date;
  v_berikutnya := (v_mulai + interval '1 month')::date;

  select coalesce(sum(t.total), 0)
  into v_penjualan
  from transaksi t
  where t.cabang_id = p_cabang
    and t.tanggal >= v_mulai
    and t.tanggal < v_berikutnya;

  select coalesce(sum(i.qty::numeric * coalesce(i.hpp_satuan, 0)), 0),
         count(*) filter (where i.hpp_satuan is null)
  into v_hpp, v_hpp_kurang
  from item_transaksi i
  join transaksi t on t.id = i.transaksi_id
  where t.cabang_id = p_cabang
    and t.tanggal >= v_mulai
    and t.tanggal < v_berikutnya;

  if v_hpp_kurang = 0 then
    v_laba_kotor := v_penjualan - v_hpp;
    v_alokasi_operasional := round(greatest(v_laba_kotor, 0) * 0.5);
    v_laba_bersih := round(greatest(v_laba_kotor, 0) * 0.5);
  end if;

  with penjualan_bulanan as (
    select date_trunc('month', t.tanggal)::date as bulan,
           sum(t.total)::numeric as penjualan
    from transaksi t
    where t.cabang_id = p_cabang
      and t.tanggal < v_mulai
    group by date_trunc('month', t.tanggal)::date
  ),
  hpp_bulanan as (
    select date_trunc('month', t.tanggal)::date as bulan,
           coalesce(sum(i.qty::numeric * coalesce(i.hpp_satuan, 0)), 0) as hpp,
           count(*) filter (where i.hpp_satuan is null) as hpp_kurang
    from transaksi t
    join item_transaksi i on i.transaksi_id = t.id
    where t.cabang_id = p_cabang
      and t.tanggal < v_mulai
    group by date_trunc('month', t.tanggal)::date
  )
  select coalesce(sum(greatest(p.penjualan - coalesce(h.hpp, 0), 0) * 0.5)
           filter (where coalesce(h.hpp_kurang, 0) = 0), 0),
         coalesce(sum(h.hpp_kurang), 0)
  into v_alokasi_sebelumnya, v_hpp_historis_kurang
  from penjualan_bulanan p
  left join hpp_bulanan h on h.bulan = p.bulan;

  select coalesce(sum(e.jumlah), 0)
  into v_pengeluaran_sebelumnya
  from pengeluaran e
  where e.cabang_id = p_cabang
    and e.tanggal < v_mulai;

  select coalesce(sum(e.jumlah), 0)
  into v_pengeluaran_bulan
  from pengeluaran e
  where e.cabang_id = p_cabang
    and e.tanggal >= v_mulai
    and e.tanggal < v_berikutnya;

  if v_hpp_historis_kurang = 0 then
    v_saldo_awal := v_alokasi_sebelumnya - v_pengeluaran_sebelumnya;
  end if;

  return jsonb_build_object(
    'cabang_id', p_cabang,
    'bulan', v_mulai,
    'penjualan', v_penjualan,
    'hpp', case when v_hpp_kurang = 0 then v_hpp else null end,
    'laba_kotor', v_laba_kotor,
    'alokasi_operasional', v_alokasi_operasional,
    'laba_bersih', v_laba_bersih,
    'pemilik_per_orang', case when v_laba_bersih is not null then round(v_laba_bersih * 0.2) else null end,
    'pemilik_total', case when v_laba_bersih is not null then round(v_laba_bersih * 0.2) * 3 else null end,
    'bonus_manager_cabang', case when v_laba_bersih is not null then round(v_laba_bersih * 0.15) else null end,
    'kas_perusahaan', case when v_laba_bersih is not null then round(v_laba_bersih * 0.25) else null end,
    'pengeluaran_bulan', v_pengeluaran_bulan,
    'saldo_operasional_awal', v_saldo_awal,
    'saldo_operasional_akhir', case
      when v_saldo_awal is not null and v_alokasi_operasional is not null
      then v_saldo_awal + v_alokasi_operasional - v_pengeluaran_bulan
      else null
    end,
    'hpp_transaksi_belum_diisi', v_hpp_kurang,
    'hpp_historis_belum_diisi', v_hpp_historis_kurang
  );
end
$function$;

revoke all on function public.laporan_laba_bulanan(uuid, date) from public;
grant execute on function public.laporan_laba_bulanan(uuid, date) to authenticated;
