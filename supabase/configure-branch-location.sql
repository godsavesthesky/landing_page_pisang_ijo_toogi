do $$
declare
  branch_count integer;
begin
  select count(*) into branch_count
  from public.cabang;

  if branch_count <> 1 then
    raise exception 'Perubahan dibatalkan: query ini hanya aman saat tabel cabang berisi tepat satu baris. Jumlah saat ini: %', branch_count;
  end if;

  update public.cabang
  set nama = 'Cabang Ikan Lodan',
      lat = -7.9338461,
      lng = 112.6374523,
      radius_m = 200
  where id = (select id from public.cabang limit 1);
end
$$;

select nama, lat, lng, radius_m, aktif
from public.cabang;
