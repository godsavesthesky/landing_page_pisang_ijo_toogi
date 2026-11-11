-- Run after accounting-setup.sql, product-production-setup.sql,
-- ingredient-inventory-setup.sql, shopee-payment-setup.sql,
-- product-management-setup.sql, team-schedule-setup.sql, and
-- attendance-visibility-setup.sql. Back up the database before applying:
-- branch-scoped policies on core tables are replaced below.

alter table public.cabang add column if not exists alamat text;

create table if not exists public.manager_cabang (
  manager_id uuid not null references public.profil(id) on delete cascade,
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  ditugaskan_oleh uuid references public.profil(id) on delete set null,
  ditugaskan_pada timestamptz not null default now(),
  primary key (manager_id, cabang_id)
);

insert into public.manager_cabang (manager_id, cabang_id)
select p.id, p.cabang_id
from public.profil p
where lower(p.peran) = 'manager' and p.cabang_id is not null
on conflict do nothing;

alter table public.manager_cabang enable row level security;
drop policy if exists manager_cabang_baca on public.manager_cabang;
create policy manager_cabang_baca
on public.manager_cabang for select to authenticated
using (
  manager_id = auth.uid()
  or lower(coalesce(peran_saya(), '')) in ('owner', 'pemilik')
);
revoke all on public.manager_cabang from anon, authenticated;
grant select on public.manager_cabang to authenticated;

create or replace function public.sinkron_manager_cabang_profil()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if lower(coalesce(new.peran, '')) = 'manager' then
    if new.cabang_id is not null then
      insert into public.manager_cabang (manager_id, cabang_id)
      values (new.id, new.cabang_id)
      on conflict do nothing;
    end if;
  elsif tg_op = 'UPDATE' and lower(coalesce(old.peran, '')) = 'manager' then
    delete from public.manager_cabang where manager_id = new.id;
  end if;
  return new;
end
$function$;

drop trigger if exists profil_manager_cabang_insert on public.profil;
create trigger profil_manager_cabang_insert
after insert on public.profil
for each row execute function public.sinkron_manager_cabang_profil();

drop trigger if exists profil_manager_cabang_update on public.profil;
create trigger profil_manager_cabang_update
after update of peran, cabang_id on public.profil
for each row execute function public.sinkron_manager_cabang_profil();

revoke all on function public.sinkron_manager_cabang_profil() from public;

create or replace function public.cabang_ok(c uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select case
      when lower(p.peran) in ('owner', 'pemilik') then true
      when lower(p.peran) = 'manager' then exists (
        select 1 from public.manager_cabang mc
        where mc.manager_id = p.id and mc.cabang_id = c
      )
      when lower(p.peran) = 'karyawan' then p.cabang_id = c
      else false
    end
    from public.profil p
    where p.id = auth.uid() and p.aktif
  ) and exists (
    select 1 from public.cabang branch where branch.id = c and branch.aktif
  ), false);
$function$;

revoke all on function public.cabang_ok(uuid) from public;
grant execute on function public.cabang_ok(uuid) to authenticated;

create or replace function public.cabang_manager_saya()
returns table (id uuid, nama text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.nama
  from public.manager_cabang mc
  join public.cabang c on c.id = mc.cabang_id
  where mc.manager_id = auth.uid()
    and c.aktif
    and lower(coalesce(public.peran_saya(), '')) = 'manager'
  order by c.nama;
$function$;

revoke all on function public.cabang_manager_saya() from public;
grant execute on function public.cabang_manager_saya() to authenticated;

create or replace function public.kelola_cabang_daftar()
returns table (id uuid, nama text, alamat text, lat double precision, lng double precision, radius_m integer, aktif boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('owner', 'pemilik') then
    raise exception 'Hanya pemilik yang dapat melihat pengaturan cabang';
  end if;
  return query
  select c.id, c.nama, c.alamat, c.lat, c.lng, c.radius_m, c.aktif
  from public.cabang c
  order by c.nama;
end
$function$;

revoke all on function public.kelola_cabang_daftar() from public;
grant execute on function public.kelola_cabang_daftar() to authenticated;

create or replace function public.cabang_publik()
returns table (id uuid, nama text, alamat text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.nama, c.alamat, c.lat, c.lng
  from public.cabang c
  where c.aktif
  order by c.nama;
$function$;

revoke all on function public.cabang_publik() from public;
grant execute on function public.cabang_publik() to anon, authenticated;

create or replace function public.buat_cabang(
  p_nama text,
  p_alamat text,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('owner', 'pemilik') then
    raise exception 'Hanya pemilik yang dapat menambahkan cabang';
  end if;
  if p_nama is null or length(trim(p_nama)) < 2 or length(trim(p_nama)) > 100
    or length(trim(coalesce(p_alamat, ''))) > 240
    or p_lat is null or p_lat < -90 or p_lat > 90
    or p_lng is null or p_lng < -180 or p_lng > 180
    or p_radius_m is null or p_radius_m < 25 or p_radius_m > 5000 then
    raise exception 'Nama, koordinat, atau radius cabang tidak valid';
  end if;
  insert into public.cabang (nama, alamat, lat, lng, radius_m, aktif)
  values (trim(p_nama), nullif(trim(p_alamat), ''), p_lat, p_lng, p_radius_m, true)
  returning id into v_id;
  return v_id;
end
$function$;

create or replace function public.ubah_cabang(
  p_cabang_id uuid,
  p_nama text,
  p_alamat text,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_aktif boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('owner', 'pemilik') then
    raise exception 'Hanya pemilik yang dapat mengubah cabang';
  end if;
  if p_nama is null or length(trim(p_nama)) < 2 or length(trim(p_nama)) > 100
    or length(trim(coalesce(p_alamat, ''))) > 240
    or p_lat is null or p_lat < -90 or p_lat > 90
    or p_lng is null or p_lng < -180 or p_lng > 180
    or p_radius_m is null or p_radius_m < 25 or p_radius_m > 5000
    or p_aktif is null then
    raise exception 'Nama, koordinat, radius, atau status cabang tidak valid';
  end if;
  if not p_aktif and (select count(*) from public.cabang where aktif) <= 1 then
    raise exception 'Cabang aktif terakhir tidak dapat dinonaktifkan';
  end if;
  update public.cabang
  set nama = trim(p_nama), alamat = nullif(trim(p_alamat), ''),
      lat = p_lat, lng = p_lng, radius_m = p_radius_m, aktif = p_aktif
  where id = p_cabang_id;
  if not found then raise exception 'Cabang tidak ditemukan'; end if;
end
$function$;

create or replace function public.atur_manager_cabang(p_cabang_id uuid, p_manager_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_manager uuid;
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('owner', 'pemilik') then
    raise exception 'Hanya pemilik yang dapat mengatur manager cabang';
  end if;
  if p_cabang_id is null or not exists (select 1 from public.cabang where id = p_cabang_id) then
    raise exception 'Cabang tidak ditemukan';
  end if;
  if coalesce(array_length(p_manager_ids, 1), 0) > 0 then
    for v_manager in select distinct unnest(p_manager_ids) loop
      if not exists (
        select 1 from public.profil
        where id = v_manager and aktif and lower(peran) = 'manager'
      ) then
        raise exception 'Semua akun yang dipilih harus manager aktif';
      end if;
    end loop;
  end if;
  delete from public.manager_cabang where cabang_id = p_cabang_id;
  insert into public.manager_cabang (manager_id, cabang_id, ditugaskan_oleh)
  select distinct selected.manager_id, p_cabang_id, auth.uid()
  from unnest(coalesce(p_manager_ids, array[]::uuid[])) as selected(manager_id);
end
$function$;

revoke all on function public.buat_cabang(text, text, double precision, double precision, integer) from public;
revoke all on function public.ubah_cabang(uuid, text, text, double precision, double precision, integer, boolean) from public;
revoke all on function public.atur_manager_cabang(uuid, uuid[]) from public;
grant execute on function public.buat_cabang(text, text, double precision, double precision, integer) to authenticated;
grant execute on function public.ubah_cabang(uuid, text, text, double precision, double precision, integer, boolean) to authenticated;
grant execute on function public.atur_manager_cabang(uuid, uuid[]) to authenticated;

create table if not exists public.harga_produk_cabang (
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  produk_id uuid not null references public.produk(id) on delete cascade,
  harga_outlet integer not null check (harga_outlet >= 0),
  harga_shopee integer check (harga_shopee is null or harga_shopee >= 0),
  diperbarui_pada timestamptz not null default now(),
  primary key (cabang_id, produk_id)
);

insert into public.harga_produk_cabang (cabang_id, produk_id, harga_outlet, harga_shopee)
select c.id, p.id, p.harga_outlet, p.harga_shopee
from public.cabang c
cross join public.produk p
on conflict (cabang_id, produk_id) do nothing;

alter table public.harga_produk_cabang enable row level security;
drop policy if exists harga_produk_cabang_baca on public.harga_produk_cabang;
create policy harga_produk_cabang_baca
on public.harga_produk_cabang for select to authenticated
using (cabang_ok(cabang_id));
revoke all on public.harga_produk_cabang from anon, authenticated;
grant select on public.harga_produk_cabang to authenticated;

create or replace function public.harga_menu_publik(p_cabang_id uuid)
returns table (produk_id uuid, nama text, harga_outlet integer, urut integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.nama, hp.harga_outlet, p.urut
  from public.cabang c
  join public.harga_produk_cabang hp on hp.cabang_id = c.id
  join public.produk p on p.id = hp.produk_id
  where c.id = p_cabang_id and c.aktif and p.aktif
  order by p.urut, p.nama;
$function$;

revoke all on function public.harga_menu_publik(uuid) from public;
grant execute on function public.harga_menu_publik(uuid) to anon, authenticated;

create or replace function public.siapkan_data_cabang_baru()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.harga_produk_cabang (cabang_id, produk_id, harga_outlet, harga_shopee)
  select new.id, p.id, p.harga_outlet, p.harga_shopee
  from public.produk p
  on conflict (cabang_id, produk_id) do nothing;

  insert into public.saldo_stok_jualan (cabang_id, produk_id, jumlah)
  select new.id, p.id, 0
  from public.produk p
  where p.aktif
  on conflict (cabang_id, produk_id) do nothing;

  insert into public.saldo_persediaan_bahan (cabang_id, bahan_id, jumlah)
  select new.id, b.id, 0
  from public.bahan_persediaan b
  where b.aktif
  on conflict (cabang_id, bahan_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists cabang_siapkan_data_awal on public.cabang;
create trigger cabang_siapkan_data_awal
after insert on public.cabang
for each row execute function public.siapkan_data_cabang_baru();

create or replace function public.siapkan_produk_di_cabang()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.harga_produk_cabang (cabang_id, produk_id, harga_outlet, harga_shopee)
  select c.id, new.id, new.harga_outlet, new.harga_shopee
  from public.cabang c
  on conflict (cabang_id, produk_id) do nothing;
  insert into public.saldo_stok_jualan (cabang_id, produk_id, jumlah)
  select c.id, new.id, 0
  from public.cabang c
  where c.aktif and new.aktif
  on conflict (cabang_id, produk_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists produk_siapkan_di_cabang on public.produk;
create trigger produk_siapkan_di_cabang
after insert on public.produk
for each row execute function public.siapkan_produk_di_cabang();

create or replace function public.ubah_produk_cabang(
  p_produk_id uuid,
  p_cabang_id uuid,
  p_nama text,
  p_harga_outlet integer,
  p_harga_shopee integer,
  p_aktif boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) <> 'manager'
    or not cabang_ok(p_cabang_id) then
    raise exception 'Hanya manager cabang yang dapat mengubah produk dan harga cabang ini';
  end if;
  if p_nama is null or length(trim(p_nama)) = 0 or length(trim(p_nama)) > 120 then
    raise exception 'Nama produk wajib diisi dan maksimal 120 karakter';
  end if;
  if p_harga_outlet is null or p_harga_outlet < 0
    or p_harga_shopee < 0 or p_aktif is null then
    raise exception 'Harga atau status produk tidak valid';
  end if;

  update public.produk set nama = trim(p_nama), aktif = p_aktif
  where id = p_produk_id;
  if not found then raise exception 'Produk tidak ditemukan'; end if;

  insert into public.harga_produk_cabang (
    cabang_id, produk_id, harga_outlet, harga_shopee, diperbarui_pada
  )
  values (p_cabang_id, p_produk_id, p_harga_outlet, p_harga_shopee, now())
  on conflict (cabang_id, produk_id) do update
  set harga_outlet = excluded.harga_outlet,
      harga_shopee = excluded.harga_shopee,
      diperbarui_pada = now();
end
$function$;

revoke all on function public.ubah_produk_cabang(uuid, uuid, text, integer, integer, boolean) from public;
grant execute on function public.ubah_produk_cabang(uuid, uuid, text, integer, integer, boolean) to authenticated;
do $$
begin
  if to_regprocedure('public.ubah_produk(uuid, text, integer, integer, boolean)') is not null then
    execute 'revoke all on function public.ubah_produk(uuid, text, integer, integer, boolean) from public, anon, authenticated';
  end if;
end
$$;

alter table public.mutasi_stok_jualan
  drop constraint if exists mutasi_stok_jualan_jenis_check;
alter table public.mutasi_stok_jualan
  add constraint mutasi_stok_jualan_jenis_check
  check (jenis in ('produksi', 'terjual', 'retur', 'terbuang', 'koreksi_masuk', 'koreksi_keluar'));

drop policy if exists saldo_stok_jualan_baca on public.saldo_stok_jualan;
create policy saldo_stok_jualan_baca on public.saldo_stok_jualan
for select to authenticated using (cabang_ok(cabang_id));
drop policy if exists mutasi_stok_jualan_baca on public.mutasi_stok_jualan;
create policy mutasi_stok_jualan_baca on public.mutasi_stok_jualan
for select to authenticated using (cabang_ok(cabang_id));

create or replace function public.koreksi_stok_jualan(
  p_produk_id uuid,
  p_arah text,
  p_jumlah numeric,
  p_catatan text,
  p_cabang_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_saldo numeric(14,3);
  v_jenis text;
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('karyawan', 'manager') then
    raise exception 'Hanya karyawan atau manager yang dapat mengoreksi stok';
  end if;
  v_cabang := case when lower(peran_saya()) = 'manager' then p_cabang_id else cabang_saya() end;
  if v_cabang is null or not cabang_ok(v_cabang) then
    raise exception 'Tidak punya akses ke cabang stok ini';
  end if;
  if p_jumlah is null or p_jumlah <= 0 or p_jumlah <> trunc(p_jumlah)
    or p_arah is null or p_arah not in ('masuk', 'keluar')
    or length(trim(coalesce(p_catatan, ''))) < 3
    or length(trim(p_catatan)) > 160 then
    raise exception 'Jumlah, arah, atau alasan koreksi stok tidak valid';
  end if;
  if not exists (select 1 from public.produk where id = p_produk_id and aktif) then
    raise exception 'Produk tidak ditemukan atau tidak aktif';
  end if;
  insert into public.saldo_stok_jualan (cabang_id, produk_id, jumlah)
  values (v_cabang, p_produk_id, 0)
  on conflict (cabang_id, produk_id) do nothing;

  if p_arah = 'masuk' then
    update public.saldo_stok_jualan
    set jumlah = jumlah + p_jumlah, diperbarui_pada = now()
    where cabang_id = v_cabang and produk_id = p_produk_id
    returning jumlah into v_saldo;
    v_jenis := 'koreksi_masuk';
  else
    update public.saldo_stok_jualan
    set jumlah = jumlah - p_jumlah, diperbarui_pada = now()
    where cabang_id = v_cabang and produk_id = p_produk_id and jumlah >= p_jumlah
    returning jumlah into v_saldo;
    if not found then raise exception 'Stok tidak cukup untuk koreksi keluar'; end if;
    v_jenis := 'koreksi_keluar';
  end if;
  insert into public.mutasi_stok_jualan (
    cabang_id, produk_id, jenis, jumlah, catatan, dicatat_oleh
  ) values (v_cabang, p_produk_id, v_jenis, p_jumlah, trim(p_catatan), auth.uid());
  return v_saldo;
end
$function$;

revoke all on function public.koreksi_stok_jualan(uuid, text, numeric, text, uuid) from public;
grant execute on function public.koreksi_stok_jualan(uuid, text, numeric, text, uuid) to authenticated;

alter table public.transaksi
  add column if not exists dibatalkan_pada timestamptz,
  add column if not exists dibatalkan_oleh uuid references public.profil(id),
  add column if not exists alasan_pembatalan text;
alter table public.item_transaksi
  add column if not exists qty_dikembalikan numeric(14,3) not null default 0,
  add column if not exists qty_dikembalikan_ke_stok numeric(14,3) not null default 0;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.item_transaksi'::regclass
      and conname = 'item_transaksi_refund_qty_check'
  ) then
    alter table public.item_transaksi
      add constraint item_transaksi_refund_qty_check
      check (
        qty_dikembalikan >= 0
        and qty_dikembalikan <= qty
        and qty_dikembalikan_ke_stok >= 0
        and qty_dikembalikan_ke_stok <= qty_dikembalikan
      );
  end if;
end
$$;

create table if not exists public.refund_penjualan (
  id uuid primary key default gen_random_uuid(),
  transaksi_id uuid not null references public.transaksi(id),
  cabang_id uuid not null references public.cabang(id),
  jumlah_refund numeric(14,2) not null check (jumlah_refund >= 0),
  ongkir_refund numeric(14,2) not null default 0 check (ongkir_refund >= 0),
  alasan text not null,
  dicatat_oleh uuid not null references public.profil(id),
  dibuat_pada timestamptz not null default now()
);

create table if not exists public.refund_item_penjualan (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refund_penjualan(id) on delete cascade,
  item_transaksi_id uuid not null references public.item_transaksi(id),
  jumlah numeric(14,3) not null check (jumlah > 0),
  masuk_stok boolean not null,
  hpp_satuan numeric(14,2),
  dibuat_pada timestamptz not null default now()
);

create index if not exists refund_penjualan_cabang_waktu_idx
  on public.refund_penjualan (cabang_id, dibuat_pada desc);
alter table public.refund_penjualan enable row level security;
alter table public.refund_item_penjualan enable row level security;
drop policy if exists refund_penjualan_baca on public.refund_penjualan;
create policy refund_penjualan_baca on public.refund_penjualan
for select to authenticated using (cabang_ok(cabang_id));
drop policy if exists refund_item_penjualan_baca on public.refund_item_penjualan;
create policy refund_item_penjualan_baca on public.refund_item_penjualan
for select to authenticated using (
  exists (
    select 1 from public.refund_penjualan r
    where r.id = refund_id and cabang_ok(r.cabang_id)
  )
);
revoke all on public.refund_penjualan, public.refund_item_penjualan from anon, authenticated;
grant select on public.refund_penjualan, public.refund_item_penjualan to authenticated;

create table if not exists public.kas_laci_sesi (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  tanggal date not null,
  saldo_awal numeric(14,2) not null check (saldo_awal >= 0),
  dibuka_oleh uuid not null references public.profil(id),
  dibuka_pada timestamptz not null default now(),
  saldo_fisik_tutup numeric(14,2),
  ditutup_oleh uuid references public.profil(id),
  ditutup_pada timestamptz,
  catatan_tutup text,
  unique (cabang_id, tanggal),
  check ((ditutup_pada is null and ditutup_oleh is null and saldo_fisik_tutup is null)
      or (ditutup_pada is not null and ditutup_oleh is not null and saldo_fisik_tutup is not null))
);

create table if not exists public.mutasi_kas_laci (
  id uuid primary key default gen_random_uuid(),
  sesi_id uuid not null references public.kas_laci_sesi(id) on delete cascade,
  jenis text not null check (jenis in ('penjualan_cash', 'refund_cash', 'setoran', 'tambah', 'koreksi_masuk', 'koreksi_keluar')),
  arah text not null check (arah in ('masuk', 'keluar')),
  jumlah numeric(14,2) not null check (jumlah > 0),
  catatan text,
  transaksi_id uuid references public.transaksi(id),
  refund_id uuid references public.refund_penjualan(id),
  dicatat_oleh uuid references public.profil(id),
  dibuat_pada timestamptz not null default now()
);

create unique index if not exists mutasi_kas_laci_penjualan_unik
  on public.mutasi_kas_laci (transaksi_id)
  where jenis = 'penjualan_cash' and transaksi_id is not null;
create unique index if not exists mutasi_kas_laci_refund_unik
  on public.mutasi_kas_laci (refund_id)
  where jenis = 'refund_cash' and refund_id is not null;
create index if not exists mutasi_kas_laci_sesi_waktu_idx
  on public.mutasi_kas_laci (sesi_id, dibuat_pada desc);

alter table public.kas_laci_sesi enable row level security;
alter table public.mutasi_kas_laci enable row level security;
drop policy if exists kas_laci_sesi_baca on public.kas_laci_sesi;
create policy kas_laci_sesi_baca on public.kas_laci_sesi
for select to authenticated using (cabang_ok(cabang_id));
drop policy if exists mutasi_kas_laci_baca on public.mutasi_kas_laci;
create policy mutasi_kas_laci_baca on public.mutasi_kas_laci
for select to authenticated using (
  exists (select 1 from public.kas_laci_sesi s where s.id = sesi_id and cabang_ok(s.cabang_id))
);
revoke all on public.kas_laci_sesi, public.mutasi_kas_laci from anon, authenticated;
grant select on public.kas_laci_sesi, public.mutasi_kas_laci to authenticated;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'absensi'
  loop
    execute format('drop policy %I on public.absensi', v_policy.policyname);
  end loop;
end
$$;
alter table public.absensi enable row level security;
create policy absensi_baca_pribadi_dan_cabang on public.absensi
for select to authenticated
using (
  karyawan_id = auth.uid()
  or exists (
    select 1 from public.profil p
    where p.id = absensi.karyawan_id
      and cabang_ok(p.cabang_id)
  )
);
revoke insert, update, delete on public.absensi from anon, authenticated;
grant select on public.absensi to authenticated;

create or replace function public.kas_laci_buka(p_cabang_id uuid, p_saldo_awal numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_id uuid;
  v_tanggal date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) <> 'manager' then
    raise exception 'Hanya manager cabang yang dapat menetapkan modal awal kas laci';
  end if;
  v_cabang := case when lower(peran_saya()) = 'manager' then p_cabang_id else cabang_saya() end;
  if v_cabang is null or not cabang_ok(v_cabang) then raise exception 'Tidak punya akses ke cabang ini'; end if;
  if p_saldo_awal is null or p_saldo_awal < 0 or p_saldo_awal <> round(p_saldo_awal, 2) then
    raise exception 'Modal awal harus nol atau lebih, maksimal dua angka desimal';
  end if;
  insert into public.kas_laci_sesi (cabang_id, tanggal, saldo_awal, dibuka_oleh)
  values (v_cabang, v_tanggal, p_saldo_awal, auth.uid())
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Kas laci cabang ini sudah dibuka hari ini';
end
$function$;

create or replace function public.kas_laci_mutasi_manual(
  p_cabang_id uuid,
  p_jenis text,
  p_jumlah numeric,
  p_catatan text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_sesi uuid;
  v_id uuid;
  v_arah text;
  v_saldo_expected numeric(14,2);
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('karyawan', 'manager') then
    raise exception 'Hanya karyawan atau manager yang dapat mencatat mutasi kas';
  end if;
  v_cabang := case when lower(peran_saya()) = 'manager' then p_cabang_id else cabang_saya() end;
  if v_cabang is null or not cabang_ok(v_cabang) then raise exception 'Tidak punya akses ke cabang ini'; end if;
  if p_jumlah is null or p_jumlah <= 0 or p_jumlah <> round(p_jumlah, 2)
    or p_jenis is null or p_jenis not in ('setoran', 'tambah', 'koreksi_masuk', 'koreksi_keluar')
    or length(trim(coalesce(p_catatan, ''))) < 3 or length(trim(p_catatan)) > 160 then
    raise exception 'Jenis, jumlah, atau alasan mutasi kas tidak valid';
  end if;
  v_arah := case when p_jenis in ('tambah', 'koreksi_masuk') then 'masuk' else 'keluar' end;
  select id into v_sesi
  from public.kas_laci_sesi
  where cabang_id = v_cabang
    and tanggal = (now() at time zone 'Asia/Jakarta')::date
    and ditutup_pada is null
  for update;
  if v_sesi is null then raise exception 'Kas laci belum dibuka atau sudah ditutup hari ini'; end if;
  select s.saldo_awal + coalesce((
    select sum(case when m.arah = 'masuk' then m.jumlah else -m.jumlah end)
    from public.mutasi_kas_laci m where m.sesi_id = s.id
  ), 0)
  into v_saldo_expected
  from public.kas_laci_sesi s where s.id = v_sesi;
  if v_arah = 'keluar' and p_jumlah > v_saldo_expected then
    raise exception 'Jumlah keluar melebihi saldo kas laci yang diharapkan';
  end if;
  insert into public.mutasi_kas_laci (sesi_id, jenis, arah, jumlah, catatan, dicatat_oleh)
  values (v_sesi, p_jenis, v_arah, p_jumlah, trim(p_catatan), auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;

create or replace function public.kas_laci_tutup(
  p_sesi_id uuid,
  p_saldo_fisik numeric,
  p_catatan text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sesi public.kas_laci_sesi%rowtype;
  v_mutasi numeric(14,2);
  v_expected numeric(14,2);
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('karyawan', 'manager') then
    raise exception 'Hanya karyawan atau manager yang dapat menutup kas laci';
  end if;
  if p_saldo_fisik is null or p_saldo_fisik < 0 or p_saldo_fisik <> round(p_saldo_fisik, 2)
    or length(trim(coalesce(p_catatan, ''))) > 160 then
    raise exception 'Jumlah kas fisik atau catatan penutupan tidak valid';
  end if;
  select * into v_sesi from public.kas_laci_sesi where id = p_sesi_id for update;
  if not found or not cabang_ok(v_sesi.cabang_id) then raise exception 'Sesi kas laci tidak ditemukan'; end if;
  if v_sesi.ditutup_pada is not null then raise exception 'Kas laci sudah ditutup'; end if;
  select coalesce(sum(case when arah = 'masuk' then jumlah else -jumlah end), 0)
  into v_mutasi from public.mutasi_kas_laci where sesi_id = p_sesi_id;
  v_expected := v_sesi.saldo_awal + v_mutasi;
  if p_saldo_fisik <> v_expected and length(trim(coalesce(p_catatan, ''))) < 3 then
    raise exception 'Catatan minimal 3 karakter wajib diisi saat kas fisik berbeda dari saldo seharusnya';
  end if;
  update public.kas_laci_sesi
  set saldo_fisik_tutup = p_saldo_fisik,
      ditutup_oleh = auth.uid(),
      ditutup_pada = now(),
      catatan_tutup = nullif(trim(p_catatan), '')
  where id = p_sesi_id;
  return jsonb_build_object(
    'saldo_diharapkan', v_expected,
    'saldo_fisik', p_saldo_fisik,
    'selisih', p_saldo_fisik - v_expected
  );
end
$function$;

create or replace function public.ringkasan_kas_laci(p_cabang_id uuid, p_tanggal date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_tanggal date := coalesce(p_tanggal, (now() at time zone 'Asia/Jakarta')::date);
  v_sesi public.kas_laci_sesi%rowtype;
  v_mutasi numeric(14,2);
begin
  v_cabang := case when lower(coalesce(peran_saya(), '')) = 'manager' then p_cabang_id else cabang_saya() end;
  if auth.uid() is null or v_cabang is null or not cabang_ok(v_cabang) then
    raise exception 'Tidak punya akses ke kas laci cabang ini';
  end if;
  select * into v_sesi from public.kas_laci_sesi
  where cabang_id = v_cabang and tanggal = v_tanggal;
  if not found then return jsonb_build_object('sesi', null, 'mutasi', '[]'::jsonb); end if;
  select coalesce(sum(case when arah = 'masuk' then jumlah else -jumlah end), 0)
  into v_mutasi from public.mutasi_kas_laci where sesi_id = v_sesi.id;
  return jsonb_build_object(
    'sesi', to_jsonb(v_sesi),
    'saldo_diharapkan', v_sesi.saldo_awal + v_mutasi,
    'selisih', case when v_sesi.saldo_fisik_tutup is null then null
                    else v_sesi.saldo_fisik_tutup - v_sesi.saldo_awal - v_mutasi end,
    'mutasi', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.dibuat_pada desc)
      from public.mutasi_kas_laci m where m.sesi_id = v_sesi.id
    ), '[]'::jsonb)
  );
end
$function$;

create or replace function public.catat_penjualan_ke_kas_laci()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sesi uuid;
begin
  if new.payment <> 'cash' or new.total is null or new.total <= 0
    or (tg_op = 'UPDATE' and new.total is not distinct from old.total) then
    return new;
  end if;
  select id into v_sesi
  from public.kas_laci_sesi
  where cabang_id = new.cabang_id
    and tanggal = (now() at time zone 'Asia/Jakarta')::date
    and ditutup_pada is null
  for update;
  if v_sesi is null then
    raise exception 'Kas laci belum dibuka atau sudah ditutup. Buka kas laci sebelum menyimpan transaksi cash.';
  end if;
  insert into public.mutasi_kas_laci (
    sesi_id, jenis, arah, jumlah, catatan, transaksi_id, dicatat_oleh
  )
  values (v_sesi, 'penjualan_cash', 'masuk', new.total + coalesce(new.ongkir, 0),
          'Transaksi cash', new.id, new.kasir_id)
  on conflict (transaksi_id) where jenis = 'penjualan_cash' and transaksi_id is not null do nothing;
  return new;
end
$function$;

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
  if tg_op = 'UPDATE' then
    if old.qty is not distinct from new.qty
      and old.produk_id is not distinct from new.produk_id
      and old.transaksi_id is not distinct from new.transaksi_id then
      return new;
    end if;
  end if;

  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    if old.stok_cabang_id is not null then
      update public.saldo_stok_jualan
      set jumlah = jumlah + old.qty, diperbarui_pada = now()
      where cabang_id = old.stok_cabang_id and produk_id = old.produk_id;
      insert into public.mutasi_stok_jualan (
        cabang_id, produk_id, jenis, jumlah, dicatat_oleh, transaksi_id
      )
      values (
        old.stok_cabang_id, old.produk_id, 'retur', old.qty,
        coalesce(auth.uid(), old.stok_dicatat_oleh), old.transaksi_id
      );
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;

  select t.cabang_id, t.kasir_id
  into v_cabang, v_kasir
  from public.transaksi t where t.id = new.transaksi_id;
  if v_cabang is null then raise exception 'Transaksi tidak ditemukan untuk perubahan stok'; end if;
  if coalesce(auth.uid(), v_kasir) is null then raise exception 'Pengguna pencatat transaksi tidak ditemukan'; end if;
  update public.saldo_stok_jualan
  set jumlah = jumlah - new.qty, diperbarui_pada = now()
  where cabang_id = v_cabang and produk_id = new.produk_id and jumlah >= new.qty
  returning cabang_id into v_saldo_cabang;
  if v_saldo_cabang is null then
    raise exception 'Stok % tidak cukup. Catat hasil produksi sebelum menyimpan transaksi.',
      (select p.nama from public.produk p where p.id = new.produk_id);
  end if;
  new.stok_cabang_id := v_cabang;
  new.stok_dicatat_oleh := coalesce(auth.uid(), v_kasir);
  insert into public.mutasi_stok_jualan (
    cabang_id, produk_id, jenis, jumlah, dicatat_oleh, transaksi_id
  ) values (v_cabang, new.produk_id, 'terjual', new.qty, coalesce(auth.uid(), v_kasir), new.transaksi_id);
  return new;
end
$function$;

drop trigger if exists transaksi_catat_ke_kas_laci on public.transaksi;
create trigger transaksi_catat_ke_kas_laci
after update of total on public.transaksi
for each row execute function public.catat_penjualan_ke_kas_laci();

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
  tot bigint := 0;
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) <> 'karyawan' then
    raise exception 'Hanya karyawan yang dapat membuat transaksi kasir';
  end if;
  cab := cabang_saya();
  if cab is null or not cabang_ok(cab) or (p_cabang is not null and p_cabang <> cab) then
    raise exception 'Akun tidak memiliki akses ke cabang transaksi ini';
  end if;
  if p_ongkir is null or p_ongkir < 0 or p_channel is null or p_payment is null
    or p_channel not in ('outlet','shopee')
    or not ((p_channel = 'outlet' and p_payment in ('qris','cash'))
      or (p_channel = 'shopee' and p_payment = 'shopee_app')) then
    raise exception 'Channel, payment, atau ongkir tidak valid';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pesanan kosong';
  end if;
  if length(trim(coalesce(p_nama, ''))) > 120 then raise exception 'Nama pembeli maksimal 120 karakter'; end if;

  insert into public.transaksi (cabang_id, kasir_id, nama_pembeli, channel, ongkir, payment)
  values (cab, auth.uid(), nullif(trim(p_nama), ''), p_channel, p_ongkir, p_payment)
  returning id into tid;

  for it in select value from jsonb_array_elements(p_items) loop
    if (it->>'qty') is null or (it->>'produk_id') is null then
      raise exception 'Item transaksi tidak lengkap';
    end if;
    q := (it->>'qty')::integer;
    if q <= 0 then raise exception 'Jumlah produk tidak valid'; end if;
    select p.id,
           case when p_channel = 'shopee' then hp.harga_shopee else hp.harga_outlet end as harga,
           ph.hpp
    into pr
    from public.produk p
    join public.harga_produk_cabang hp on hp.produk_id = p.id and hp.cabang_id = cab
    left join public.produk_hpp ph on ph.produk_id = p.id and ph.cabang_id = cab
    where p.id = (it->>'produk_id')::uuid and p.aktif;
    if not found or pr.harga is null then raise exception 'Produk atau harga cabang tidak tersedia'; end if;
    insert into public.item_transaksi (transaksi_id, produk_id, qty, harga_satuan, hpp_satuan)
    values (tid, pr.id, q, pr.harga, pr.hpp);
    tot := tot + q::bigint * pr.harga;
  end loop;
  if tot > 2147483647 then raise exception 'Total transaksi melebihi batas maksimum'; end if;
  update public.transaksi set total = tot::integer where id = tid;
  return tid;
end
$function$;

revoke all on function public.buat_transaksi(text, text, integer, text, jsonb, uuid) from public;
grant execute on function public.buat_transaksi(text, text, integer, text, jsonb, uuid) to authenticated;

create or replace function public.proses_refund_transaksi(
  p_transaksi_id uuid,
  p_items jsonb,
  p_batalkan boolean,
  p_refund_ongkir boolean,
  p_alasan text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_transaksi public.transaksi%rowtype;
  v_item_input jsonb;
  v_item public.item_transaksi%rowtype;
  v_refund_id uuid;
  v_qty numeric(14,3);
  v_harga numeric(14,2);
  v_total numeric(14,2) := 0;
  v_ongkir numeric(14,2) := 0;
  v_ongkir_refunded numeric(14,2) := 0;
  v_sesi uuid;
  v_remaining numeric(14,3);
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('manager', 'owner', 'pemilik') then
    raise exception 'Hanya manager atau pemilik yang dapat memproses refund';
  end if;
  if p_batalkan is null or p_refund_ongkir is null
    or p_alasan is null or length(trim(p_alasan)) < 3 or length(trim(p_alasan)) > 160
    or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pilih item dan isi alasan refund (3–160 karakter)';
  end if;
  select * into v_transaksi from public.transaksi where id = p_transaksi_id for update;
  if not found or not cabang_ok(v_transaksi.cabang_id) then
    raise exception 'Transaksi tidak ditemukan atau bukan cabang yang dapat diakses';
  end if;
  if v_transaksi.dibatalkan_pada is not null then raise exception 'Transaksi ini sudah dibatalkan'; end if;
  if p_refund_ongkir and not p_batalkan then
    raise exception 'Ongkir hanya dapat dikembalikan saat seluruh transaksi dibatalkan';
  end if;

  insert into public.refund_penjualan (
    transaksi_id, cabang_id, jumlah_refund, ongkir_refund, alasan, dicatat_oleh
  ) values (p_transaksi_id, v_transaksi.cabang_id, 0, 0, trim(p_alasan), auth.uid())
  returning id into v_refund_id;

  for v_item_input in select value from jsonb_array_elements(p_items) loop
    if (v_item_input->>'item_id') is null or (v_item_input->>'qty') is null
      or (v_item_input->>'restock') is null then
      raise exception 'Rincian refund item tidak lengkap';
    end if;
    v_qty := (v_item_input->>'qty')::numeric;
    if v_qty <= 0 or v_qty <> trunc(v_qty) then raise exception 'Jumlah refund item tidak valid'; end if;
    select * into v_item
    from public.item_transaksi
    where id = (v_item_input->>'item_id')::uuid and transaksi_id = p_transaksi_id
    for update;
    if not found then raise exception 'Item tidak termasuk transaksi ini'; end if;
    v_remaining := v_item.qty - v_item.qty_dikembalikan;
    if v_qty > v_remaining then raise exception 'Jumlah refund melebihi sisa item yang dapat dikembalikan'; end if;
    if (v_item_input->>'restock')::boolean then
      insert into public.saldo_stok_jualan (cabang_id, produk_id, jumlah)
      values (v_transaksi.cabang_id, v_item.produk_id, v_qty)
      on conflict (cabang_id, produk_id) do update
      set jumlah = public.saldo_stok_jualan.jumlah + excluded.jumlah,
          diperbarui_pada = now();
      insert into public.mutasi_stok_jualan (
        cabang_id, produk_id, jenis, jumlah, catatan, dicatat_oleh, transaksi_id
      ) values (
        v_transaksi.cabang_id, v_item.produk_id, 'retur', v_qty,
        'Refund item layak jual: ' || trim(p_alasan), auth.uid(), p_transaksi_id
      );
      update public.item_transaksi
      set qty_dikembalikan = qty_dikembalikan + v_qty,
          qty_dikembalikan_ke_stok = qty_dikembalikan_ke_stok + v_qty
      where id = v_item.id;
    else
      update public.item_transaksi
      set qty_dikembalikan = qty_dikembalikan + v_qty
      where id = v_item.id;
    end if;
    v_harga := v_qty * v_item.harga_satuan;
    v_total := v_total + v_harga;
    insert into public.refund_item_penjualan (
      refund_id, item_transaksi_id, jumlah, masuk_stok, hpp_satuan
    ) values (v_refund_id, v_item.id, v_qty, (v_item_input->>'restock')::boolean, v_item.hpp_satuan);
  end loop;

  if v_total <= 0 and not p_batalkan then raise exception 'Jumlah refund harus lebih dari nol'; end if;
  if p_batalkan and exists (
    select 1 from public.item_transaksi
    where transaksi_id = p_transaksi_id and qty_dikembalikan < qty
  ) then
    raise exception 'Pembatalan penuh harus mencakup semua sisa item transaksi';
  end if;
  if p_refund_ongkir then
    select coalesce(sum(r.ongkir_refund), 0) into v_ongkir_refunded
    from public.refund_penjualan r where r.transaksi_id = p_transaksi_id;
    v_ongkir := greatest(coalesce(v_transaksi.ongkir, 0) - v_ongkir_refunded, 0);
    if v_ongkir <= 0 then raise exception 'Ongkir transaksi ini sudah pernah direfund'; end if;
  end if;
  update public.refund_penjualan
  set jumlah_refund = v_total, ongkir_refund = v_ongkir
  where id = v_refund_id;
  if p_batalkan then
    update public.transaksi
    set dibatalkan_pada = now(), dibatalkan_oleh = auth.uid(), alasan_pembatalan = trim(p_alasan)
    where id = p_transaksi_id;
  end if;

  if v_transaksi.payment = 'cash' and v_total + v_ongkir > 0 then
    select id into v_sesi from public.kas_laci_sesi
    where cabang_id = v_transaksi.cabang_id
      and tanggal = (now() at time zone 'Asia/Jakarta')::date
      and ditutup_pada is null
    for update;
    if v_sesi is null then
      raise exception 'Refund cash memerlukan kas laci yang sudah dibuka hari ini';
    end if;
    if v_total + v_ongkir > (
      select s.saldo_awal + coalesce(sum(case when m.arah = 'masuk' then m.jumlah else -m.jumlah end), 0)
      from public.kas_laci_sesi s
      left join public.mutasi_kas_laci m on m.sesi_id = s.id
      where s.id = v_sesi
      group by s.id
    ) then
      raise exception 'Saldo laci tidak cukup untuk mengeluarkan refund cash ini';
    end if;
    insert into public.mutasi_kas_laci (
      sesi_id, jenis, arah, jumlah, catatan, transaksi_id, refund_id, dicatat_oleh
    ) values (
      v_sesi, 'refund_cash', 'keluar', v_total + v_ongkir,
      'Refund transaksi: ' || trim(p_alasan), p_transaksi_id, v_refund_id, auth.uid()
    );
  end if;
  return jsonb_build_object('id', v_refund_id, 'jumlah_refund', v_total, 'ongkir_refund', v_ongkir);
end
$function$;

revoke all on function public.proses_refund_transaksi(uuid, jsonb, boolean, boolean, text) from public;
grant execute on function public.proses_refund_transaksi(uuid, jsonb, boolean, boolean, text) to authenticated;

create or replace function public.laporan_laba_bulanan(p_cabang uuid, p_bulan date)
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
  v_hpp_historis_kurang numeric := 0;
  v_saldo_awal numeric;
begin
  if auth.uid() is null or lower(coalesce(peran_saya(), '')) not in ('owner', 'pemilik') then
    raise exception 'Hanya pemilik yang dapat melihat laporan laba';
  end if;
  if p_cabang is null or not cabang_ok(p_cabang) or p_bulan is null then
    raise exception 'Cabang dan bulan laporan yang valid wajib dipilih';
  end if;
  v_mulai := date_trunc('month', p_bulan)::date;
  v_berikutnya := (v_mulai + interval '1 month')::date;

  select coalesce((
    select sum(t.total) from public.transaksi t
    where t.cabang_id = p_cabang and t.tanggal >= v_mulai and t.tanggal < v_berikutnya
  ), 0) - coalesce((
    select sum(r.jumlah_refund) from public.refund_penjualan r
    where r.cabang_id = p_cabang
      and r.dibuat_pada >= (v_mulai::timestamp at time zone 'Asia/Jakarta')
      and r.dibuat_pada < (v_berikutnya::timestamp at time zone 'Asia/Jakarta')
  ), 0)
  into v_penjualan;

  select coalesce(sum(i.qty * i.hpp_satuan), 0),
         count(*) filter (where i.hpp_satuan is null and i.qty > 0)
  into v_hpp, v_hpp_kurang
  from public.item_transaksi i
  join public.transaksi t on t.id = i.transaksi_id
  where t.cabang_id = p_cabang and t.tanggal >= v_mulai and t.tanggal < v_berikutnya;

  select v_penjualan - (v_hpp - coalesce(sum(ri.jumlah * ri.hpp_satuan)
    filter (where ri.masuk_stok
      and r.dibuat_pada >= (v_mulai::timestamp at time zone 'Asia/Jakarta')
      and r.dibuat_pada < (v_berikutnya::timestamp at time zone 'Asia/Jakarta')), 0)
  )
  into v_laba_kotor
  from public.refund_item_penjualan ri
  join public.refund_penjualan r on r.id = ri.refund_id
  where r.cabang_id = p_cabang;
  if v_hpp_kurang = 0 then
    v_alokasi_operasional := round(greatest(v_laba_kotor, 0) * 0.5);
    v_laba_bersih := round(greatest(v_laba_kotor, 0) * 0.5);
  else
    v_laba_kotor := null;
  end if;

  with sales_month as (
    select date_trunc('month', t.tanggal)::date bulan, sum(t.total)::numeric amount
    from public.transaksi t
    where t.cabang_id = p_cabang and t.tanggal < v_mulai
    group by 1
  ), refund_month as (
    select date_trunc('month', r.dibuat_pada at time zone 'Asia/Jakarta')::date bulan, -sum(r.jumlah_refund)::numeric amount
    from public.refund_penjualan r
    where r.cabang_id = p_cabang
      and r.dibuat_pada < (v_mulai::timestamp at time zone 'Asia/Jakarta')
    group by 1
  ), hpp_raw as (
    select date_trunc('month', t.tanggal)::date bulan,
      sum(i.qty * i.hpp_satuan)::numeric amount
    from public.transaksi t join public.item_transaksi i on i.transaksi_id = t.id
    where t.cabang_id = p_cabang and t.tanggal < v_mulai and i.hpp_satuan is not null
    group by 1
    union all
    select date_trunc('month', r.dibuat_pada at time zone 'Asia/Jakarta')::date bulan,
      -sum(ri.jumlah * ri.hpp_satuan)::numeric amount
    from public.refund_penjualan r join public.refund_item_penjualan ri on ri.refund_id = r.id
    where r.cabang_id = p_cabang
      and r.dibuat_pada < (v_mulai::timestamp at time zone 'Asia/Jakarta')
      and ri.masuk_stok and ri.hpp_satuan is not null
    group by 1
  ), hpp_month as (
    select bulan, sum(amount)::numeric amount
    from hpp_raw
    group by bulan
  ), monthly_profit as (
    select coalesce(s.bulan, r.bulan, h.bulan) bulan,
      coalesce(s.amount, 0) + coalesce(r.amount, 0) - coalesce(h.amount, 0) profit
    from sales_month s
    full join refund_month r on r.bulan = s.bulan
    full join hpp_month h on h.bulan = coalesce(s.bulan, r.bulan)
  )
  select coalesce(sum(greatest(profit, 0) * 0.5), 0)
  into v_alokasi_sebelumnya from monthly_profit;

  select count(*)
  into v_hpp_historis_kurang
  from public.transaksi t join public.item_transaksi i on i.transaksi_id = t.id
  where t.cabang_id = p_cabang and t.tanggal < v_mulai
    and i.hpp_satuan is null and i.qty > 0;

  select coalesce(sum(e.jumlah), 0) into v_pengeluaran_sebelumnya
  from public.pengeluaran e where e.cabang_id = p_cabang and e.tanggal < v_mulai;
  select coalesce(sum(e.jumlah), 0) into v_pengeluaran_bulan
  from public.pengeluaran e where e.cabang_id = p_cabang
    and e.tanggal >= v_mulai and e.tanggal < v_berikutnya;
  if v_hpp_historis_kurang = 0 then
    v_saldo_awal := v_alokasi_sebelumnya - v_pengeluaran_sebelumnya;
  end if;

  return jsonb_build_object(
    'cabang_id', p_cabang, 'bulan', v_mulai, 'penjualan', v_penjualan,
    'hpp', case when v_hpp_kurang = 0 then v_hpp else null end,
    'laba_kotor', v_laba_kotor, 'alokasi_operasional', v_alokasi_operasional,
    'laba_bersih', v_laba_bersih,
    'pemilik_per_orang', case when v_laba_bersih is not null then round(v_laba_bersih * 0.2) else null end,
    'pemilik_total', case when v_laba_bersih is not null then round(v_laba_bersih * 0.2) * 3 else null end,
    'bonus_manager_cabang', case when v_laba_bersih is not null then round(v_laba_bersih * 0.15) else null end,
    'kas_perusahaan', case when v_laba_bersih is not null then round(v_laba_bersih * 0.25) else null end,
    'pengeluaran_bulan', v_pengeluaran_bulan, 'saldo_operasional_awal', v_saldo_awal,
    'saldo_operasional_akhir', case when v_saldo_awal is not null and v_alokasi_operasional is not null
      then v_saldo_awal + v_alokasi_operasional - v_pengeluaran_bulan else null end,
    'hpp_transaksi_belum_diisi', v_hpp_kurang,
    'hpp_historis_belum_diisi', v_hpp_historis_kurang
  );
end
$function$;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('profil', 'cabang', 'transaksi', 'item_transaksi', 'pengeluaran')
  loop
    execute format('drop policy %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;
end
$$;

alter table public.profil enable row level security;
create policy profil_baca_sesuai_cabang on public.profil
for select to authenticated
using (
  id = auth.uid()
  or lower(coalesce(peran_saya(), '')) in ('owner', 'pemilik')
  or (
    lower(coalesce(peran_saya(), '')) = 'manager'
    and exists (
      select 1 from public.manager_cabang mc
      where mc.manager_id = auth.uid()
        and (
          mc.cabang_id = profil.cabang_id
          or exists (
            select 1 from public.manager_cabang target_mc
            where target_mc.manager_id = profil.id and target_mc.cabang_id = mc.cabang_id
          )
        )
    )
  )
  or (
    lower(coalesce(peran_saya(), '')) = 'karyawan'
    and profil.cabang_id = cabang_saya()
  )
);
grant select on public.profil to authenticated;

alter table public.cabang enable row level security;
create policy cabang_baca_sesuai_akses on public.cabang
for select to authenticated using (cabang_ok(id));
revoke insert, update, delete on public.cabang from anon, authenticated;
grant select on public.cabang to authenticated;

alter table public.transaksi enable row level security;
create policy transaksi_baca_sesuai_cabang on public.transaksi
for select to authenticated using (cabang_ok(cabang_id));
revoke insert, update, delete on public.transaksi from anon, authenticated;
grant select on public.transaksi to authenticated;

alter table public.item_transaksi enable row level security;
create policy item_transaksi_baca_sesuai_cabang on public.item_transaksi
for select to authenticated using (
  exists (
    select 1 from public.transaksi t
    where t.id = transaksi_id and cabang_ok(t.cabang_id)
  )
);
revoke insert, update, delete on public.item_transaksi from anon, authenticated;
grant select on public.item_transaksi to authenticated;

alter table public.pengeluaran enable row level security;
create policy pengeluaran_baca_owner on public.pengeluaran
for select to authenticated
using (lower(coalesce(peran_saya(), '')) in ('owner', 'pemilik') and cabang_ok(cabang_id));
create policy pengeluaran_tulis_owner on public.pengeluaran
for insert to authenticated
with check (lower(coalesce(peran_saya(), '')) in ('owner', 'pemilik') and cabang_ok(cabang_id));
revoke update, delete on public.pengeluaran from anon, authenticated;
grant select, insert on public.pengeluaran to authenticated;

drop policy if exists produk_hpp_baca on public.produk_hpp;
drop policy if exists produk_hpp_tulis on public.produk_hpp;
create policy produk_hpp_baca on public.produk_hpp
for select to authenticated
using (
  lower(coalesce(peran_saya(), '')) in ('owner', 'pemilik', 'manager')
  and cabang_ok(cabang_id)
);
create policy produk_hpp_tulis on public.produk_hpp
for all to authenticated
using (
  lower(coalesce(peran_saya(), '')) in ('owner', 'pemilik', 'manager')
  and cabang_ok(cabang_id)
)
with check (
  lower(coalesce(peran_saya(), '')) in ('owner', 'pemilik', 'manager')
  and cabang_ok(cabang_id)
);
alter table public.produk_hpp enable row level security;
grant select, insert, update, delete on public.produk_hpp to authenticated;
revoke insert, update, delete on public.produk from anon, authenticated;
grant select on public.produk to authenticated;

revoke all on function public.siapkan_data_cabang_baru() from public;
revoke all on function public.siapkan_produk_di_cabang() from public;
revoke all on function public.catat_penjualan_ke_kas_laci() from public;
revoke all on function public.kas_laci_buka(uuid, numeric) from public;
revoke all on function public.kas_laci_mutasi_manual(uuid, text, numeric, text) from public;
revoke all on function public.kas_laci_tutup(uuid, numeric, text) from public;
revoke all on function public.ringkasan_kas_laci(uuid, date) from public;
revoke all on function public.laporan_laba_bulanan(uuid, date) from public;
grant execute on function public.kas_laci_buka(uuid, numeric) to authenticated;
grant execute on function public.kas_laci_mutasi_manual(uuid, text, numeric, text) to authenticated;
grant execute on function public.kas_laci_tutup(uuid, numeric, text) to authenticated;
grant execute on function public.ringkasan_kas_laci(uuid, date) to authenticated;
grant execute on function public.laporan_laba_bulanan(uuid, date) to authenticated;
