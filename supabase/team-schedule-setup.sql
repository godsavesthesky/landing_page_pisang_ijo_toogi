create table if not exists public.shift_definisi (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  nama text not null check (length(trim(nama)) between 1 and 60),
  jam_mulai time not null,
  jam_selesai time not null,
  aktif boolean not null default true,
  dibuat_oleh uuid not null default auth.uid() references public.profil(id),
  dibuat_pada timestamptz not null default now(),
  constraint shift_tidak_lintas_hari check (jam_selesai > jam_mulai),
  unique (cabang_id, id)
);

create table if not exists public.jadwal_mingguan (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  karyawan_id uuid not null references public.profil(id) on delete cascade,
  hari smallint not null check (hari between 0 and 6),
  shift_id uuid not null,
  diubah_oleh uuid not null default auth.uid() references public.profil(id),
  diubah_pada timestamptz not null default now(),
  unique (cabang_id, karyawan_id, hari),
  constraint jadwal_mingguan_shift_satu_cabang
    foreign key (cabang_id, shift_id) references public.shift_definisi(cabang_id, id)
);

alter table public.jadwal_mingguan
  alter column shift_id drop not null,
  add column if not exists libur boolean not null default false;

alter table public.jadwal_mingguan
  drop constraint if exists jadwal_mingguan_shift_valid;
alter table public.jadwal_mingguan
  add constraint jadwal_mingguan_shift_valid
  check ((libur and shift_id is null) or (not libur and shift_id is not null));

create table if not exists public.jadwal_tanggal (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  karyawan_id uuid not null references public.profil(id) on delete cascade,
  tanggal date not null,
  shift_id uuid,
  libur boolean not null default false,
  diubah_oleh uuid not null default auth.uid() references public.profil(id),
  diubah_pada timestamptz not null default now(),
  unique (cabang_id, karyawan_id, tanggal),
  constraint jadwal_tanggal_shift_satu_cabang
    foreign key (cabang_id, shift_id) references public.shift_definisi(cabang_id, id),
  constraint jadwal_tanggal_shift_valid check (
    (libur and shift_id is null) or (not libur and shift_id is not null)
  )
);

create table if not exists public.jobdesk (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  karyawan_id uuid not null references public.profil(id) on delete cascade,
  tanggal date not null default current_date,
  tugas text not null check (length(trim(tugas)) between 1 and 500),
  status text not null default 'belum' check (status in ('belum', 'proses', 'selesai')),
  dibuat_oleh uuid not null default auth.uid() references public.profil(id),
  dibuat_pada timestamptz not null default now(),
  selesai_pada timestamptz
);

alter table public.jadwal_mingguan
  drop constraint if exists jadwal_mingguan_shift_id_fkey;
alter table public.jadwal_tanggal
  drop constraint if exists jadwal_tanggal_shift_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.jadwal_mingguan'::regclass
      and conname = 'jadwal_mingguan_shift_satu_cabang'
  ) then
    alter table public.jadwal_mingguan
      add constraint jadwal_mingguan_shift_satu_cabang
      foreign key (cabang_id, shift_id)
      references public.shift_definisi(cabang_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.jadwal_tanggal'::regclass
      and conname = 'jadwal_tanggal_shift_satu_cabang'
  ) then
    alter table public.jadwal_tanggal
      add constraint jadwal_tanggal_shift_satu_cabang
      foreign key (cabang_id, shift_id)
      references public.shift_definisi(cabang_id, id);
  end if;
end
$$;

with duplikat as (
  select id,
         first_value(id) over (
           partition by cabang_id, lower(trim(nama)), jam_mulai, jam_selesai
           order by dibuat_pada, id
         ) as id_utama,
         row_number() over (
           partition by cabang_id, lower(trim(nama)), jam_mulai, jam_selesai
           order by dibuat_pada, id
         ) as nomor
  from public.shift_definisi
  where aktif
),
pemetaan as (
  select id, id_utama
  from duplikat
  where nomor > 1
)
update public.jadwal_mingguan as jadwal
set shift_id = pemetaan.id_utama
from pemetaan
where jadwal.shift_id = pemetaan.id;

with duplikat as (
  select id,
         first_value(id) over (
           partition by cabang_id, lower(trim(nama)), jam_mulai, jam_selesai
           order by dibuat_pada, id
         ) as id_utama,
         row_number() over (
           partition by cabang_id, lower(trim(nama)), jam_mulai, jam_selesai
           order by dibuat_pada, id
         ) as nomor
  from public.shift_definisi
  where aktif
),
pemetaan as (
  select id, id_utama
  from duplikat
  where nomor > 1
)
update public.jadwal_tanggal as jadwal
set shift_id = pemetaan.id_utama
from pemetaan
where jadwal.shift_id = pemetaan.id;

with duplikat as (
  select id,
         row_number() over (
           partition by cabang_id, lower(trim(nama)), jam_mulai, jam_selesai
           order by dibuat_pada, id
         ) as nomor
  from public.shift_definisi
  where aktif
)
delete from public.shift_definisi as shift
using duplikat
where shift.id = duplikat.id
  and duplikat.nomor > 1;

create unique index if not exists shift_definisi_aktif_unik
  on public.shift_definisi (cabang_id, lower(trim(nama)), jam_mulai, jam_selesai)
  where aktif;

do $$
begin
  if auth.uid() is null and not exists (
    select 1
    from public.profil
    where aktif
      and lower(peran) in ('pemilik', 'owner')
  ) then
    raise exception 'Tidak ada akun pemilik aktif untuk mencatat pembuat shift awal.';
  end if;
end
$$;

insert into public.shift_definisi (cabang_id, nama, jam_mulai, jam_selesai, aktif, dibuat_oleh)
select cabang.id, shifts.nama, shifts.jam_mulai, shifts.jam_selesai, true, actor.id
from public.cabang as cabang
cross join (
  values
    ('Pagi'::text, time '09:00', time '13:00'),
    ('Siang'::text, time '12:00', time '17:00'),
    ('Full-time'::text, time '09:00', time '17:00')
) as shifts(nama, jam_mulai, jam_selesai)
cross join lateral (
  select coalesce(
    (select profil.id from public.profil as profil where profil.id = auth.uid()),
    (
      select profil.id
      from public.profil as profil
      where profil.aktif
        and lower(profil.peran) in ('pemilik', 'owner')
      order by profil.id
      limit 1
    )
  ) as id
) as actor
where not exists (
  select 1
  from public.shift_definisi as existing
  where existing.cabang_id = cabang.id
    and existing.aktif
    and existing.nama = shifts.nama
    and existing.jam_mulai = shifts.jam_mulai
    and existing.jam_selesai = shifts.jam_selesai
)
and actor.id is not null;

update public.jadwal_mingguan as jadwal
set shift_id = target.id
from public.shift_definisi as old_shift
join public.shift_definisi as target
  on target.cabang_id = old_shift.cabang_id
 and target.aktif
where old_shift.id = jadwal.shift_id
  and old_shift.id <> target.id
  and (
    (old_shift.nama = 'Full-time' and old_shift.jam_mulai = time '09:00'
      and old_shift.jam_selesai = time '17:00' and target.nama = 'Full-time'
      and target.jam_mulai = time '09:00' and target.jam_selesai = time '17:00')
    or (old_shift.jam_mulai < time '11:00' and target.nama = 'Pagi'
      and target.jam_mulai = time '09:00' and target.jam_selesai = time '13:00')
    or
    (old_shift.jam_mulai >= time '11:00' and target.nama = 'Siang'
      and target.jam_mulai = time '12:00' and target.jam_selesai = time '17:00')
  );

update public.jadwal_tanggal as jadwal
set shift_id = target.id
from public.shift_definisi as old_shift
join public.shift_definisi as target
  on target.cabang_id = old_shift.cabang_id
 and target.aktif
where old_shift.id = jadwal.shift_id
  and old_shift.id <> target.id
  and (
    (old_shift.nama = 'Full-time' and old_shift.jam_mulai = time '09:00'
      and old_shift.jam_selesai = time '17:00' and target.nama = 'Full-time'
      and target.jam_mulai = time '09:00' and target.jam_selesai = time '17:00')
    or (old_shift.jam_mulai < time '11:00' and target.nama = 'Pagi'
      and target.jam_mulai = time '09:00' and target.jam_selesai = time '13:00')
    or
    (old_shift.jam_mulai >= time '11:00' and target.nama = 'Siang'
      and target.jam_mulai = time '12:00' and target.jam_selesai = time '17:00')
  );

update public.shift_definisi
set aktif = false
where aktif
  and not (
    (nama = 'Pagi' and jam_mulai = time '09:00' and jam_selesai = time '13:00')
    or (nama = 'Siang' and jam_mulai = time '12:00' and jam_selesai = time '17:00')
    or (nama = 'Full-time' and jam_mulai = time '09:00' and jam_selesai = time '17:00')
  );

create table if not exists public.jadwal_riwayat (
  id uuid primary key default gen_random_uuid(),
  cabang_id uuid not null references public.cabang(id) on delete cascade,
  karyawan_id uuid not null references public.profil(id) on delete cascade,
  jenis text not null check (jenis in ('mingguan', 'tanggal')),
  hari smallint check (hari between 0 and 6),
  tanggal date,
  shift_id_lama uuid,
  shift_id_baru uuid,
  tindakan text not null check (tindakan in ('tambah', 'ubah', 'hapus')),
  diubah_oleh uuid references public.profil(id),
  diubah_pada timestamptz not null default now()
);

create index if not exists jadwal_mingguan_karyawan_idx
  on public.jadwal_mingguan (karyawan_id, cabang_id, hari);
create index if not exists jadwal_tanggal_lookup_idx
  on public.jadwal_tanggal (karyawan_id, cabang_id, tanggal);
create index if not exists jobdesk_tanggal_cabang_idx
  on public.jobdesk (cabang_id, tanggal, karyawan_id);

create or replace function public.pastikan_target_karyawan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target public.profil%rowtype;
begin
  select * into target
  from public.profil
  where id = new.karyawan_id;

  if not found or not target.aktif or target.peran <> 'karyawan' or target.cabang_id is distinct from new.cabang_id then
    raise exception 'Jadwal dan jobdesk hanya dapat diberikan kepada karyawan aktif di cabang yang sama';
  end if;

  return new;
end
$function$;

drop trigger if exists jadwal_mingguan_target_karyawan on public.jadwal_mingguan;
create trigger jadwal_mingguan_target_karyawan
before insert or update of karyawan_id, cabang_id on public.jadwal_mingguan
for each row execute function public.pastikan_target_karyawan();

drop trigger if exists jadwal_tanggal_target_karyawan on public.jadwal_tanggal;
create trigger jadwal_tanggal_target_karyawan
before insert or update of karyawan_id, cabang_id on public.jadwal_tanggal
for each row execute function public.pastikan_target_karyawan();

drop trigger if exists jobdesk_target_karyawan on public.jobdesk;
create trigger jobdesk_target_karyawan
before insert or update of karyawan_id, cabang_id on public.jobdesk
for each row execute function public.pastikan_target_karyawan();

alter table public.shift_definisi enable row level security;
alter table public.jadwal_mingguan enable row level security;
alter table public.jadwal_tanggal enable row level security;
alter table public.jobdesk enable row level security;
alter table public.jadwal_riwayat enable row level security;

drop policy if exists jadwal_riwayat_baca on public.jadwal_riwayat;
create policy jadwal_riwayat_baca on public.jadwal_riwayat
for select to authenticated using (is_mgr() and cabang_ok(cabang_id));

create or replace function public.catat_riwayat_jadwal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.jadwal_riwayat (
      cabang_id, karyawan_id, jenis, hari, tanggal, shift_id_baru, tindakan, diubah_oleh
    ) values (
      new.cabang_id, new.karyawan_id,
      case when tg_table_name = 'jadwal_mingguan' then 'mingguan' else 'tanggal' end,
      case when tg_table_name = 'jadwal_mingguan' then new.hari else null end,
      case when tg_table_name = 'jadwal_tanggal' then new.tanggal else null end,
      new.shift_id, 'tambah', auth.uid()
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.jadwal_riwayat (
      cabang_id, karyawan_id, jenis, hari, tanggal, shift_id_lama, shift_id_baru, tindakan, diubah_oleh
    ) values (
      new.cabang_id, new.karyawan_id,
      case when tg_table_name = 'jadwal_mingguan' then 'mingguan' else 'tanggal' end,
      case when tg_table_name = 'jadwal_mingguan' then new.hari else null end,
      case when tg_table_name = 'jadwal_tanggal' then new.tanggal else null end,
      old.shift_id, new.shift_id, 'ubah', auth.uid()
    );
    return new;
  else
    insert into public.jadwal_riwayat (
      cabang_id, karyawan_id, jenis, hari, tanggal, shift_id_lama, tindakan, diubah_oleh
    ) values (
      old.cabang_id, old.karyawan_id,
      case when tg_table_name = 'jadwal_mingguan' then 'mingguan' else 'tanggal' end,
      case when tg_table_name = 'jadwal_mingguan' then old.hari else null end,
      case when tg_table_name = 'jadwal_tanggal' then old.tanggal else null end,
      old.shift_id, 'hapus', auth.uid()
    );
    return old;
  end if;
end
$function$;

drop trigger if exists jadwal_mingguan_riwayat on public.jadwal_mingguan;
create trigger jadwal_mingguan_riwayat
after insert or update or delete on public.jadwal_mingguan
for each row execute function public.catat_riwayat_jadwal();

drop trigger if exists jadwal_tanggal_riwayat on public.jadwal_tanggal;
create trigger jadwal_tanggal_riwayat
after insert or update or delete on public.jadwal_tanggal
for each row execute function public.catat_riwayat_jadwal();

drop policy if exists shift_definisi_baca on public.shift_definisi;
create policy shift_definisi_baca on public.shift_definisi
for select to authenticated using (cabang_ok(cabang_id));
drop policy if exists shift_definisi_kelola on public.shift_definisi;
create policy shift_definisi_kelola on public.shift_definisi
for all to authenticated
using (is_mgr() and cabang_ok(cabang_id))
with check (is_mgr() and cabang_ok(cabang_id));

drop policy if exists jadwal_mingguan_baca on public.jadwal_mingguan;
create policy jadwal_mingguan_baca on public.jadwal_mingguan
for select to authenticated using (cabang_ok(cabang_id) and (is_mgr() or karyawan_id = auth.uid()));
drop policy if exists jadwal_mingguan_kelola on public.jadwal_mingguan;
create policy jadwal_mingguan_kelola on public.jadwal_mingguan
for all to authenticated
using (is_mgr() and cabang_ok(cabang_id))
with check (is_mgr() and cabang_ok(cabang_id));

drop policy if exists jadwal_tanggal_baca on public.jadwal_tanggal;
create policy jadwal_tanggal_baca on public.jadwal_tanggal
for select to authenticated using (cabang_ok(cabang_id) and (is_mgr() or karyawan_id = auth.uid()));
drop policy if exists jadwal_tanggal_kelola on public.jadwal_tanggal;
create policy jadwal_tanggal_kelola on public.jadwal_tanggal
for all to authenticated
using (is_mgr() and cabang_ok(cabang_id))
with check (is_mgr() and cabang_ok(cabang_id));

drop policy if exists jobdesk_baca on public.jobdesk;
create policy jobdesk_baca on public.jobdesk
for select to authenticated
using (cabang_ok(cabang_id) and (is_mgr() or karyawan_id = auth.uid()));
drop policy if exists jobdesk_tambah on public.jobdesk;
create policy jobdesk_tambah on public.jobdesk
for insert to authenticated
with check (is_mgr() and cabang_ok(cabang_id));
drop policy if exists jobdesk_hapus on public.jobdesk;
create policy jobdesk_hapus on public.jobdesk
for delete to authenticated
using (is_mgr() and cabang_ok(cabang_id));
drop policy if exists jobdesk_status_rpc_saja on public.jobdesk;
create policy jobdesk_status_rpc_saja on public.jobdesk
for update to authenticated using (false) with check (false);

create or replace function public.ubah_status_jobdesk(p_jobdesk_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tugas public.jobdesk%rowtype;
begin
  if p_status not in ('proses', 'selesai') then
    raise exception 'Status jobdesk tidak valid';
  end if;

  select * into tugas
  from public.jobdesk
  where id = p_jobdesk_id
  for update;

  if not found then raise exception 'Jobdesk tidak ditemukan'; end if;
  if not cabang_ok(tugas.cabang_id) then raise exception 'Tidak punya akses ke cabang jobdesk ini'; end if;
  if tugas.karyawan_id <> auth.uid() and not is_mgr() then
    raise exception 'Tidak punya akses untuk mengubah status jobdesk ini';
  end if;
  if tugas.status = 'selesai' and p_status <> 'selesai' and not is_mgr() then
    raise exception 'Jobdesk yang selesai hanya dapat dibuka kembali oleh manager';
  end if;

  update public.jobdesk
  set status = p_status,
      selesai_pada = case when p_status = 'selesai' then now() else null end
  where id = p_jobdesk_id;
end
$function$;

revoke all on function public.ubah_status_jobdesk(uuid, text) from public;
grant execute on function public.ubah_status_jobdesk(uuid, text) to authenticated;
