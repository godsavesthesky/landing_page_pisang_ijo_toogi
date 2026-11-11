drop policy if exists absensi_tim_baca on public.absensi;
create policy absensi_tim_baca
on public.absensi for select
to authenticated
using (
  is_pemilik()
  or (
    is_mgr()
    and exists (
      select 1
      from public.profil p
      where p.id = absensi.karyawan_id
        and cabang_ok(p.cabang_id)
    )
  )
);
