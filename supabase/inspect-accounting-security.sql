select jsonb_build_object(
  'constraints',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'table', c.relname,
        'name', con.conname,
        'type', con.contype,
        'definition', pg_get_constraintdef(con.oid)
      )
      order by c.relname, con.conname
    )
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('produk_hpp', 'item_transaksi', 'transaksi', 'pengeluaran', 'profil', 'cabang')
  ), '[]'::jsonb),
  'policies',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'table', tablename,
        'name', policyname,
        'command', cmd,
        'roles', roles,
        'using', qual,
        'check', with_check
      )
      order by tablename, policyname
    )
    from pg_policies
    where schemaname = 'public'
      and tablename in ('produk_hpp', 'item_transaksi', 'transaksi', 'pengeluaran', 'profil', 'cabang')
  ), '[]'::jsonb),
  'role_functions',
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'signature', p.oid::regprocedure::text,
        'definition', pg_get_functiondef(p.oid)
      )
      order by p.oid::regprocedure::text
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('peran_saya', 'is_mgr', 'cabang_saya')
  ), '[]'::jsonb)
) as accounting_security_inspection;
