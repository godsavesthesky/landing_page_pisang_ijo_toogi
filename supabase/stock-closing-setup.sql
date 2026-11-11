alter table public.stok_harian
  add column if not exists stok_akhir numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stok_harian'::regclass
      and conname = 'stok_harian_stok_akhir_check'
  ) then
    alter table public.stok_harian
      add constraint stok_harian_stok_akhir_check
      check (stok_akhir is null or stok_akhir >= 0);
  end if;
end;
$$;

create or replace function public.simpan_stok_closing(
  p_tanggal date,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabang uuid;
  v_item jsonb;
  v_bahan uuid;
  v_stok_akhir numeric;
begin
  if auth.uid() is null or peran_saya() not in ('karyawan', 'manager') then
    raise exception 'Hanya karyawan atau manager yang dapat menyimpan stok closing';
  end if;

  v_cabang := cabang_saya();
  if v_cabang is null then
    raise exception 'Akun belum terhubung ke cabang aktif';
  end if;
  if p_tanggal is distinct from (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Stok closing hanya dapat disimpan untuk hari ini';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Daftar stok closing tidak valid';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Daftar stok closing kosong atau tidak valid';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_bahan := (v_item->>'stok_dasar_id')::uuid;
    v_stok_akhir := (v_item->>'stok_akhir')::numeric;

    if v_stok_akhir is null or v_stok_akhir < 0
      or not exists (select 1 from public.stok_dasar where id = v_bahan) then
      raise exception 'Bahan atau jumlah stok closing tidak valid';
    end if;

    insert into public.stok_harian (
      tanggal, cabang_id, stok_dasar_id, stok_awal, tambahan, stok_akhir
    )
    values (p_tanggal, v_cabang, v_bahan, 0, 0, v_stok_akhir)
    on conflict do update set stok_akhir = excluded.stok_akhir;

    insert into public.stok_harian (
      tanggal, cabang_id, stok_dasar_id, stok_awal, tambahan
    )
    values (p_tanggal + 1, v_cabang, v_bahan, v_stok_akhir, 0)
    on conflict do update set stok_awal = excluded.stok_awal;
  end loop;
end;
$function$;

revoke all on function public.simpan_stok_closing(date, jsonb) from public;
grant execute on function public.simpan_stok_closing(date, jsonb) to authenticated;
