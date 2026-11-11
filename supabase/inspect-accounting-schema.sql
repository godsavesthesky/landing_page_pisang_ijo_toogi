select jsonb_build_object(
  'relevant_columns',
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
        table_name ilike '%trans%'
        or table_name ilike '%produk%'
        or table_name ilike '%penjualan%'
        or table_name ilike '%pengeluaran%'
        or table_name ilike '%operasional%'
        or table_name ilike '%laba%'
      )
  ), '[]'::jsonb),
  'transaction_functions',
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
      and p.proname in ('buat_transaksi')
  ), '[]'::jsonb)
) as accounting_schema_inspection;
