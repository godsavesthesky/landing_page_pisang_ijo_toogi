alter table public.transaksi
  drop constraint if exists transaksi_payment_check;

alter table public.transaksi
  drop constraint if exists transaksi_payment_channel_check;

update public.transaksi
set payment = 'shopee_app'
where channel = 'shopee'
  and payment in ('cash', 'qris');

alter table public.transaksi
  add constraint transaksi_payment_channel_check
  check (
    channel is not null
    and payment is not null
    and (
      (channel = 'outlet' and payment in ('cash', 'qris'))
      or (channel = 'shopee' and payment = 'shopee_app')
    )
  );

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
