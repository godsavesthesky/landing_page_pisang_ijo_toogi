create table if not exists public.saldo_stok_jualan (
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  produk_id uuid not null references public.produk(id) on delete cascade,
  jumlah numeric(14, 3) not null default 0 check (jumlah >= 0),
  diperbarui_pada timestamptz not null default now(),
  primary key (cabang_id, produk_id)
);

insert into public.saldo_stok_jualan (cabang_id, produk_id, jumlah)
select c.id, p.id, 0
from public.cabang c
cross join public.produk p
where c.aktif and p.aktif
on conflict (cabang_id, produk_id) do nothing;

create table if not exists public.mutasi_stok_jualan (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  produk_id uuid not null references public.produk(id),
  jenis text not null check (jenis in ('produksi', 'terjual', 'retur')),
  jumlah numeric(14, 3) not null check (jumlah > 0),
  dicatat_oleh uuid not null references public.profil(id),
  transaksi_id uuid references public.transaksi(id) on delete set null,
  dibuat_pada timestamptz not null default now()
);

alter table public.mutasi_stok_jualan
  add column if not exists catatan text;

alter table public.mutasi_stok_jualan
  drop constraint if exists mutasi_stok_jualan_jenis_check;

alter table public.mutasi_stok_jualan
  add constraint mutasi_stok_jualan_jenis_check
  check (jenis in ('produksi', 'terjual', 'retur', 'terbuang'));

create index if not exists mutasi_stok_jualan_cabang_waktu_idx
  on public.mutasi_stok_jualan (cabang_id, dibuat_pada desc);

alter table public.item_transaksi
  add column if not exists stok_cabang_id uuid references public.cabang(id);

alter table public.item_transaksi
  add column if not exists stok_dicatat_oleh uuid references public.profil(id);

alter table public.saldo_stok_jualan enable row level security;
alter table public.mutasi_stok_jualan enable row level security;

drop policy if exists saldo_stok_jualan_baca on public.saldo_stok_jualan;
create policy saldo_stok_jualan_baca
on public.saldo_stok_jualan for select
to authenticated
using (
  peran_saya() in ('karyawan', 'manager', 'pemilik')
  and (cabang_id = cabang_saya() or is_pemilik())
);

drop policy if exists mutasi_stok_jualan_baca on public.mutasi_stok_jualan;
create policy mutasi_stok_jualan_baca
on public.mutasi_stok_jualan for select
to authenticated
using (
  peran_saya() in ('karyawan', 'manager', 'pemilik')
  and (cabang_id = cabang_saya() or is_pemilik())
);

revoke all on public.saldo_stok_jualan from anon, authenticated;
revoke all on public.mutasi_stok_jualan from anon, authenticated;
grant select on public.saldo_stok_jualan to authenticated;
grant select on public.mutasi_stok_jualan to authenticated;

create or replace function public.catat_produksi_produk(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_item jsonb;
  v_produk uuid;
  v_jumlah integer;
  v_jumlah_input numeric;
begin
  if auth.uid() is null or peran_saya() <> 'karyawan' then
    raise exception 'Hanya karyawan yang dapat mencatat hasil produksi';
  end if;
  v_cabang := cabang_saya();
  if v_cabang is null then
    raise exception 'Akun belum terhubung ke cabang aktif';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Daftar hasil produksi tidak valid';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Belum ada hasil produksi yang diisi';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_produk := (v_item->>'produk_id')::uuid;
    v_jumlah_input := (v_item->>'jumlah')::numeric;
    if v_jumlah_input is null
      or v_jumlah_input <= 0
      or v_jumlah_input <> trunc(v_jumlah_input)
      or v_jumlah_input > 2147483647 then
      raise exception 'Jumlah produksi harus bilangan bulat lebih dari nol';
    end if;
    v_jumlah := v_jumlah_input::integer;
    if not exists (select 1 from public.produk where id = v_produk and aktif) then
      raise exception 'Produk tidak ditemukan atau tidak aktif';
    end if;

    insert into public.saldo_stok_jualan (cabang_id, produk_id, jumlah)
    values (v_cabang, v_produk, v_jumlah)
    on conflict (cabang_id, produk_id)
    do update set jumlah = public.saldo_stok_jualan.jumlah + excluded.jumlah,
                  diperbarui_pada = now();

    insert into public.mutasi_stok_jualan (
      cabang_id, produk_id, jenis, jumlah, dicatat_oleh
    )
    values (v_cabang, v_produk, 'produksi', v_jumlah, auth.uid());
  end loop;
end;
$function$;

revoke all on function public.catat_produksi_produk(jsonb) from public;
grant execute on function public.catat_produksi_produk(jsonb) to authenticated;

create or replace function public.catat_stok_terbuang(
  p_produk_id uuid,
  p_jumlah integer,
  p_alasan text,
  p_catatan text default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_saldo numeric(14, 3);
  v_pencatat uuid;
  v_catatan text;
begin
  if auth.uid() is null or peran_saya() <> 'karyawan' then
    raise exception 'Hanya karyawan yang dapat mencatat produk terbuang';
  end if;
  if p_jumlah is null or p_jumlah <= 0 then
    raise exception 'Jumlah produk terbuang harus lebih dari nol';
  end if;
  if p_alasan is null or p_alasan not in ('basi', 'rusak', 'jatuh/terkontaminasi', 'lainnya') then
    raise exception 'Pilih alasan produk terbuang';
  end if;
  if length(trim(coalesce(p_catatan, ''))) > 160 then
    raise exception 'Catatan maksimal 160 karakter';
  end if;

  v_cabang := cabang_saya();
  v_pencatat := auth.uid();
  if v_cabang is null then
    raise exception 'Akun belum terhubung ke cabang aktif';
  end if;
  if not exists (select 1 from public.produk where id = p_produk_id and aktif) then
    raise exception 'Produk tidak ditemukan atau tidak aktif';
  end if;

  update public.saldo_stok_jualan
  set jumlah = jumlah - p_jumlah, diperbarui_pada = now()
  where cabang_id = v_cabang
    and produk_id = p_produk_id
    and jumlah >= p_jumlah
  returning jumlah into v_saldo;

  if not found then
    raise exception 'Stok produk tidak cukup untuk mencatat jumlah terbuang';
  end if;

  v_catatan := p_alasan;
  if nullif(trim(p_catatan), '') is not null then
    v_catatan := v_catatan || ': ' || trim(p_catatan);
  end if;

  insert into public.mutasi_stok_jualan (
    cabang_id, produk_id, jenis, jumlah, dicatat_oleh, catatan
  )
  values (v_cabang, p_produk_id, 'terbuang', p_jumlah, v_pencatat, v_catatan);

  return v_saldo;
end;
$function$;

revoke all on function public.catat_stok_terbuang(uuid, integer, text, text) from public;
grant execute on function public.catat_stok_terbuang(uuid, integer, text, text) to authenticated;

create or replace function public.sesuaikan_stok_saat_transaksi()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_kasir uuid;
  v_saldo_cabang uuid;
begin
  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    if old.stok_cabang_id is not null then
      update public.saldo_stok_jualan
      set jumlah = jumlah + old.qty, diperbarui_pada = now()
      where cabang_id = old.stok_cabang_id and produk_id = old.produk_id;

      insert into public.mutasi_stok_jualan (
        cabang_id, produk_id, jenis, jumlah, dicatat_oleh, transaksi_id
      )
      values (
        old.stok_cabang_id,
        old.produk_id,
        'retur',
        old.qty,
        coalesce(auth.uid(), old.stok_dicatat_oleh),
        old.transaksi_id
      );
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  select t.cabang_id, t.kasir_id
  into v_cabang, v_kasir
  from public.transaksi t
  where t.id = new.transaksi_id;
  if v_cabang is null then
    raise exception 'Transaksi tidak ditemukan untuk perubahan stok';
  end if;
  if coalesce(auth.uid(), v_kasir) is null then
    raise exception 'Pengguna pencatat transaksi tidak ditemukan';
  end if;

  update public.saldo_stok_jualan
  set jumlah = jumlah - new.qty, diperbarui_pada = now()
  where cabang_id = v_cabang
    and produk_id = new.produk_id
    and jumlah >= new.qty
  returning cabang_id into v_saldo_cabang;

  if v_saldo_cabang is null then
    raise exception 'Stok % tidak cukup. Catat hasil produksi sebelum menyimpan transaksi.',
      (select p.nama from public.produk p where p.id = new.produk_id);
  end if;

  new.stok_cabang_id := v_cabang;
  new.stok_dicatat_oleh := coalesce(auth.uid(), v_kasir);
  insert into public.mutasi_stok_jualan (
    cabang_id, produk_id, jenis, jumlah, dicatat_oleh, transaksi_id
  )
  values (
    v_cabang, new.produk_id, 'terjual', new.qty,
    coalesce(auth.uid(), v_kasir), new.transaksi_id
  );
  return new;
end;
$function$;

revoke all on function public.sesuaikan_stok_saat_transaksi() from public;

drop trigger if exists item_transaksi_sesuaikan_stok on public.item_transaksi;
create trigger item_transaksi_sesuaikan_stok
before insert or update or delete on public.item_transaksi
for each row execute function public.sesuaikan_stok_saat_transaksi();

do $$
begin
  if to_regprocedure('public.simpan_stok_closing(date,jsonb)') is not null then
    execute 'revoke all on function public.simpan_stok_closing(date, jsonb) from authenticated, public';
  end if;
end;
$$;
