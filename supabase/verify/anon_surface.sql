-- Qué puede tocar anon en public (solo lectura del catálogo de privilegios).
select json_build_object(
  'tables_or_views_with_any_anon_privilege', (select coalesce(json_agg(c.relname::text order by c.relname), '[]'::json)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))),
  'sequences_with_anon_privilege', (select coalesce(json_agg(c.relname::text order by c.relname), '[]'::json)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
        and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'SELECT')
          or has_sequence_privilege('anon', c.oid, 'UPDATE'))),
  'functions_anon_can_execute', (select coalesce(json_agg(p.oid::regprocedure::text order by p.proname), '[]'::json)
      from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'rls_public', (select count(*) filter (where relrowsecurity)::text || '/' || count(*)::text
      from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')
) as anon_surface;
