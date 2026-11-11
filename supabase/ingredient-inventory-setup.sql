create table if not exists public.bahan_persediaan (
  id uuid primary key default gen_random_uuid(),
  nama text not null unique,
  satuan text not null check (satuan in ('pack', 'pcs', 'ltr')),
  aktif boolean not null default true,
  dibuat_pada timestamptz not null default now()
);

insert into public.bahan_persediaan (nama, satuan)
values
  ('Tepung Terigu Fla', 'pack'),
  ('Tepung Beras Fla', 'pack'),
  ('Gula', 'pack'),
  ('Garam', 'pack'),
  ('Daun Pandan', 'pcs'),
  ('Tepung Terigu Kulit', 'pack'),
  ('Pisang', 'pcs'),
  ('Santan', 'ltr'),
  ('Pasta Pandan', 'pcs'),
  ('Mentega', 'pack'),
  ('Sirup DHT', 'ltr'),
  ('SKM', 'pcs'),
  ('Es Batu', 'pcs'),
  ('Ice Cream Durian', 'pcs'),
  ('Saos Jalangkote', 'pcs'),
  ('Jalangkote Frozen', 'pcs'),
  ('Kemasan Mika', 'pack'),
  ('Cup Sirup', 'pack'),
  ('Kresek Besar', 'pack'),
  ('Kresek Kecil', 'pack'),
  ('Sendok Plastik', 'pack'),
  ('Bungkusan Jalangkote', 'pack')
on conflict (nama) do update
set satuan = excluded.satuan,
    aktif = true;

create table if not exists public.saldo_persediaan_bahan (
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  bahan_id uuid not null references public.bahan_persediaan(id),
  jumlah numeric(14, 3) not null default 0 check (jumlah >= 0),
  diperbarui_pada timestamptz not null default now(),
  primary key (cabang_id, bahan_id)
);

create table if not exists public.mutasi_persediaan_bahan (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  bahan_id uuid not null references public.bahan_persediaan(id),
  jenis text not null check (jenis in ('tambah', 'pakai')),
  jumlah numeric(14, 3) not null check (jumlah > 0),
  catatan text,
  dicatat_oleh uuid not null references public.profil(id),
  dibuat_pada timestamptz not null default now()
);

create index if not exists mutasi_persediaan_bahan_cabang_waktu_idx
  on public.mutasi_persediaan_bahan (cabang_id, dibuat_pada desc);

alter table public.bahan_persediaan enable row level security;
alter table public.saldo_persediaan_bahan enable row level security;
alter table public.mutasi_persediaan_bahan enable row level security;

drop policy if exists bahan_persediaan_baca on public.bahan_persediaan;
create policy bahan_persediaan_baca
on public.bahan_persediaan for select
to authenticated
using (aktif and peran_saya() in ('karyawan', 'manager', 'pemilik'));

drop policy if exists saldo_persediaan_bahan_baca on public.saldo_persediaan_bahan;
create policy saldo_persediaan_bahan_baca
on public.saldo_persediaan_bahan for select
to authenticated
using (peran_saya() in ('karyawan', 'manager', 'pemilik') and cabang_ok(cabang_id));

drop policy if exists mutasi_persediaan_bahan_baca on public.mutasi_persediaan_bahan;
create policy mutasi_persediaan_bahan_baca
on public.mutasi_persediaan_bahan for select
to authenticated
using (peran_saya() in ('karyawan', 'manager', 'pemilik') and cabang_ok(cabang_id));

grant select on public.bahan_persediaan to authenticated;
grant select on public.saldo_persediaan_bahan to authenticated;
grant select on public.mutasi_persediaan_bahan to authenticated;

create or replace function public.catat_mutasi_persediaan_bahan(
  p_bahan_id uuid,
  p_jenis text,
  p_jumlah numeric,
  p_catatan text default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_satuan text;
  v_saldo numeric(14, 3);
begin
  if auth.uid() is null or peran_saya() <> 'karyawan' then
    raise exception 'Hanya karyawan yang dapat mencatat perubahan persediaan';
  end if;
  if p_jumlah is null or p_jumlah <= 0
    or p_jumlah <> round(p_jumlah, 3)
    or p_jenis is null
    or p_jenis not in ('tambah', 'pakai') then
    raise exception 'Jenis perubahan atau jumlah tidak valid';
  end if;
  if length(trim(coalesce(p_catatan, ''))) > 160 then
    raise exception 'Catatan maksimal 160 karakter';
  end if;

  v_cabang := cabang_saya();
  if v_cabang is null then
    raise exception 'Akun belum terhubung ke cabang aktif';
  end if;

  select satuan into v_satuan
  from public.bahan_persediaan
  where id = p_bahan_id and aktif;
  if not found then
    raise exception 'Bahan tidak ditemukan atau tidak aktif';
  end if;
  if v_satuan <> 'ltr' and p_jumlah <> trunc(p_jumlah) then
    raise exception 'Jumlah untuk satuan pack atau pcs harus bilangan bulat';
  end if;

  insert into public.saldo_persediaan_bahan (cabang_id, bahan_id, jumlah)
  values (v_cabang, p_bahan_id, 0)
  on conflict (cabang_id, bahan_id) do nothing;

  select jumlah into v_saldo
  from public.saldo_persediaan_bahan
  where cabang_id = v_cabang and bahan_id = p_bahan_id
  for update;

  if p_jenis = 'pakai' and p_jumlah > v_saldo then
    raise exception 'Persediaan tidak cukup. Saldo saat ini: % %', v_saldo, v_satuan;
  end if;

  v_saldo := case
    when p_jenis = 'tambah' then v_saldo + p_jumlah
    else v_saldo - p_jumlah
  end;

  update public.saldo_persediaan_bahan
  set jumlah = v_saldo, diperbarui_pada = now()
  where cabang_id = v_cabang and bahan_id = p_bahan_id;

  insert into public.mutasi_persediaan_bahan (
    cabang_id, bahan_id, jenis, jumlah, catatan, dicatat_oleh
  )
  values (
    v_cabang, p_bahan_id, p_jenis, p_jumlah, nullif(trim(p_catatan), ''), auth.uid()
  );

  return v_saldo;
end;
$function$;

revoke all on function public.catat_mutasi_persediaan_bahan(uuid, text, numeric, text) from public;
grant execute on function public.catat_mutasi_persediaan_bahan(uuid, text, numeric, text) to authenticated;
