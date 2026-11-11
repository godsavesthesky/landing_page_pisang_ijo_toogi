create or replace function public.ubah_produk(
  p_produk_id uuid,
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
  if peran_saya() <> 'manager' then
    raise exception 'Hanya manager yang dapat mengubah produk';
  end if;

  if p_nama is null or length(trim(p_nama)) = 0 or length(trim(p_nama)) > 120 then
    raise exception 'Nama produk wajib diisi dan maksimal 120 karakter';
  end if;
  if p_harga_outlet is null or p_harga_outlet < 0 then
    raise exception 'Harga outlet harus nol atau lebih';
  end if;
  if p_harga_shopee < 0 then
    raise exception 'Harga Shopee harus nol atau lebih';
  end if;
  if p_aktif is null then
    raise exception 'Status produk tidak valid';
  end if;

  update public.produk
  set nama = trim(p_nama),
      harga_outlet = p_harga_outlet,
      harga_shopee = p_harga_shopee,
      aktif = p_aktif
  where id = p_produk_id;

  if not found then
    raise exception 'Produk tidak ditemukan';
  end if;
end
$function$;

revoke all on function public.ubah_produk(uuid, text, integer, integer, boolean) from public;
grant execute on function public.ubah_produk(uuid, text, integer, integer, boolean) to authenticated;
