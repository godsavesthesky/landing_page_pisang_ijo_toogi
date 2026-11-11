select jsonb_build_object(
  'columns',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'table', table_name,
        'column', column_name,
        'type', data_type,
        'nullable', is_nullable,
        'default', column_default
      )
      order by table_name, ordinal_position
    )
    from information_schema.columns
    where table_schema = 'public'
      and (
        table_name in (
          'cabang', 'profil', 'transaksi', 'item_transaksi', 'produk',
          'produk_hpp', 'pengeluaran', 'absensi', 'stok_dasar',
          'stok_harian', 'stok_produk', 'resep', 'resep_produk',
          'bahan_persediaan', 'saldo_persediaan_bahan',
          'mutasi_persediaan_bahan', 'saldo_stok_jualan',
          'mutasi_stok_jualan',
          'jadwal_mingguan', 'jadwal_tanggal'
        )
        or table_name ilike '%resep%'
        or table_name ilike '%stok%'
        or table_name ilike '%bahan%'
      )
  ), '[]'::jsonb),
  'views',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', viewname,
        'definition', definition
      )
      order by viewname
    )
    from pg_views
    where schemaname = 'public'
      and (
        viewname ilike '%stok%'
        or viewname ilike '%transaksi%'
        or viewname ilike '%produk%'
      )
  ), '[]'::jsonb),
  'stock_rules',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'product', p.nama,
        'product_id', a.produk_id,
        'ingredient', sd.nama,
        'ingredient_id', a.stok_dasar_id,
        'quantity_per_product', a.jumlah
      )
      order by p.nama, sd.nama
    )
    from public.aturan_stok a
    join public.produk p on p.id = a.produk_id
    join public.stok_dasar sd on sd.id = a.stok_dasar_id
  ), '[]'::jsonb),
  'functions',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'signature', p.oid::regprocedure::text,
        'result', pg_get_function_result(p.oid),
        'definition', pg_get_functiondef(p.oid)
      )
      order by p.oid::regprocedure::text
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'buat_transaksi', 'absen', 'cabang_ok', 'cabang_saya',
        'laporan_laba_bulanan'
      )
  ), '[]'::jsonb),
  'policies',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'table', tablename,
        'name', policyname,
        'command', cmd,
        'using', qual,
        'check', with_check
      )
      order by tablename, policyname
    )
    from pg_policies
    where schemaname = 'public'
      and (
        tablename in ('transaksi', 'item_transaksi', 'pengeluaran', 'absensi', 'profil')
        or tablename ilike '%stok%'
        or tablename ilike '%resep%'
      )
  ), '[]'::jsonb)
) as client_revision_schema;
