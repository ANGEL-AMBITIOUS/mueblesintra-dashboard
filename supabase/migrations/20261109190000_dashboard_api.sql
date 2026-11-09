-- MUEBLESINTRA BACKEND · migración 5: API de datos del dashboard público (solo agregados).
-- Una función SECURITY DEFINER en public, search_path vacío, que devuelve un snapshot JSON del motor:
-- pedidos por estado, producción por estación, piezas/escaneos, bultos, inventario, costos, catálogo, calidad y
-- salud del motor. Sin datos personales: ni nombres de clientes/ejecutivos/operadores, ni ids de usuario.
-- Las tablas base conservan RLS; anon NO lee ninguna tabla, solo ejecuta esta función.
-- Dinero y porcentajes salen como texto ya redondeado en Postgres (numeric), para que el navegador no use float.
-- Docs: https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker
--       https://supabase.com/docs/guides/api/securing-your-api
create function public.dashboard_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with
sv as (select * from public.v_scan_validity),
pt as (select * from public.v_part_tracking),
ord as (
    select
        o.code,
        o.promised_on,
        count(p.label_code) filter (where p.active) as active_parts,
        count(p.label_code) filter (where t.packed) as packed_parts,
        (select count(*) from sv join public.parts p2 on p2.label_code = sv.label_code
         where p2.order_code = o.code and sv.label_valid and not sv.duplicate) as valid_scans,
        (select coalesce(sum(pc.cost), 0) from public.part_costs pc join public.parts p3 on p3.label_code = pc.label_code
         where p3.order_code = o.code) as material_cost,
        (select count(*) from public.v_package_status ps where ps.order_code = o.code and ps.status <> 'NO APLICA')
            as packages_applicable,
        (select count(*) from public.v_package_status ps where ps.order_code = o.code and ps.status = 'COMPLETO')
            as packages_complete,
        (select count(distinct l.package_code) from public.logistics_log l join public.packages pk on pk.code = l.package_code
         where pk.order_code = o.code) as packages_delivered
    from public.orders o
    left join public.parts p on p.order_code = o.code
    left join pt t on t.label_code = p.label_code
    group by o.code, o.promised_on
),
ord_status as (
    select ord.*,
        case
            when active_parts = 0 then 'SIN PIEZAS'
            when packed_parts = active_parts then 'LISTO PARA EMBARQUE'
            when valid_scans > 0 then 'EN PRODUCCION'
            else 'PENDIENTE'
        end as status
    from ord
),
appr as (
    select
        coalesce(sum(l.amount), 0) as amount,
        coalesce(sum(m.unit_cost * m.qty), 0) as cost
    from public.projects pr
    join public.project_modules m on m.folio = pr.folio
    join public.v_project_lines l on l.line_id = m.line_id
    where pr.status = 'APROBADA'
)
select jsonb_build_object(
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'engine', jsonb_build_object(
        'excel_rows', (select rows_accepted from meta.import_batches order by loaded_at desc limit 1),
        'excel_sheets', (select sheets from meta.import_batches order by loaded_at desc limit 1),
        'source_sha256_12', (select left(source_sha256, 12) from meta.import_batches order by loaded_at desc limit 1),
        'tables_public', (select count(*) from pg_catalog.pg_class
                          where relnamespace = 'public'::regnamespace and relkind = 'r'),
        'tables_public_rls', (select count(*) from pg_catalog.pg_class
                              where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity),
        'policies_public', (select count(*) from pg_catalog.pg_policies where schemaname = 'public'),
        'selftest_probes', (select probes from meta.rls_selftest_runs order by run_id desc limit 1),
        'selftest_passed', (select passed from meta.rls_selftest_runs order by run_id desc limit 1),
        'selftest_at', (select to_char(run_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                        from meta.rls_selftest_runs order by run_id desc limit 1)
    ),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object(
            'code', code,
            'promised_on', promised_on,
            'status', status,
            'active_parts', active_parts,
            'packed_parts', packed_parts,
            'progress_pct', case when active_parts = 0 then '0.0'
                                 else round(packed_parts * 100.0 / active_parts, 1)::text end,
            'valid_scans', valid_scans,
            'material_cost_mxn', round(material_cost, 2)::text,
            'packages_applicable', packages_applicable,
            'packages_complete', packages_complete,
            'packages_delivered', packages_delivered
        ) order by code), '[]'::jsonb) from ord_status),
    'orders_by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'n', s.n) order by s.ord), '[]'::jsonb)
        from (select v.status, v.ord, (select count(*) from ord_status os where os.status = v.status) as n
              from (values ('PENDIENTE', 1), ('EN PRODUCCION', 2), ('LISTO PARA EMBARQUE', 3), ('SIN PIEZAS', 4))
                   as v (status, ord)) s),
    'totals', jsonb_build_object(
        'orders', (select count(*) from public.orders),
        'active_parts', (select count(*) from public.parts where active),
        'packed_parts', (select count(*) from pt where packed),
        'progress_pct', (select case when count(*) filter (where active) = 0 then '0.0'
                                     else round(count(*) filter (where packed) * 100.0 / count(*) filter (where active), 1)::text end
                         from pt),
        'parts_cost_mxn', (select round(coalesce(sum(cost), 0), 2)::text from public.part_costs)
    ),
    'stations', (select coalesce(jsonb_agg(jsonb_build_object(
            'code', st.code,
            'seq', st.seq,
            'wip_parts', (select count(*) from pt where pt.active and not pt.packed and pt.last_station = st.code
                          and pt.last_result = 'OK'),
            'valid_scans', (select count(*) from sv where sv.station = st.code and sv.label_valid and not sv.duplicate),
            'rejects', (select count(*) from sv where sv.station = st.code and sv.label_valid and not sv.duplicate
                        and sv.result = 'RECHAZO'),
            'tasks', jsonb_build_object(
                'pending', (select count(*) from public.station_tasks k where k.station = st.code and k.status = 'pending'),
                'in_progress', (select count(*) from public.station_tasks k where k.station = st.code and k.status = 'in_progress'),
                'waiting_handoff', (select count(*) from public.station_tasks k where k.station = st.code and k.status = 'waiting_handoff'),
                'done', (select count(*) from public.station_tasks k where k.station = st.code and k.status = 'done'),
                'no_aplica', (select count(*) from public.station_tasks k where k.station = st.code and k.status = 'no_aplica')
            )
        ) order by st.seq), '[]'::jsonb) from public.stations st),
    'parts_by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'n', s.n) order by s.ord), '[]'::jsonb)
        from (select pt.status, count(*) as n,
                     case pt.status when 'SIN INICIAR' then 0 when 'RECHAZADA - RECORTE' then 90 when 'EMPACADA' then 99
                         else coalesce((select st.seq from public.stations st where 'EN ' || st.code = pt.status), 50) end as ord
              from pt where pt.active group by pt.status) s),
    'scans', jsonb_build_object(
        'total', (select count(*) from sv),
        'valid', (select count(*) from sv where label_valid and not duplicate),
        'duplicate', (select count(*) from sv where duplicate),
        'invalid_label', (select count(*) from sv where not label_valid),
        'last_scan_at', (select to_char(max(scanned_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from sv)
    ),
    'packages', jsonb_build_object(
        'complete', (select count(*) from public.v_package_status where status = 'COMPLETO'),
        'incomplete', (select count(*) from public.v_package_status where status = 'INCOMPLETO'),
        'not_applicable', (select count(*) from public.v_package_status where status = 'NO APLICA'),
        'deliveries', (select count(*) from public.logistics_log),
        'delivered_packages', (select count(distinct package_code) from public.logistics_log)
    ),
    'inventory', jsonb_build_object(
        'total_value_mxn', (select round(coalesce(sum(value), 0), 2)::text from public.v_inventory),
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', i.code,
                'kind', i.kind,
                'unit', i.unit,
                'stock', i.stock::text,
                'reorder_point', i.reorder_point::text,
                'value_mxn', i.value::text,
                'at_or_below_reorder', i.stock <= i.reorder_point
            ) order by i.kind desc, i.code), '[]'::jsonb) from public.v_inventory i)
    ),
    'quotes', jsonb_build_object(
        'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'n', s.n, 'total_mxn', s.total)
                                                order by s.ord), '[]'::jsonb)
            from (select v.status, v.ord,
                         (select count(*) from public.v_project_totals t where t.status = v.status) as n,
                         (select round(coalesce(sum(t.total), 0), 2)::text from public.v_project_totals t
                          where t.status = v.status) as total
                  from (values ('BORRADOR', 1), ('ENVIADA', 2), ('APROBADA', 3), ('RECHAZADA', 4)) as v (status, ord)) s),
        'lifecycle', (select coalesce(jsonb_agg(jsonb_build_object('status', s.project_status, 'n', s.n) order by s.ord),
                                      '[]'::jsonb)
            from (select v.project_status, v.ord,
                         (select count(*) from public.projects p where p.project_status = v.project_status) as n
                  from (values ('COTIZADO', 1), ('LIBERADO', 2), ('ACTIVADO', 3), ('FINIQUITADO', 4), ('TERMINADO', 5),
                               ('ENTREGADO', 6), ('ELIMINADO', 7)) as v (project_status, ord)) s),
        'approved_amount_mxn', (select round(amount, 2)::text from appr),
        'approved_cost_mxn', (select round(cost, 2)::text from appr),
        'approved_margin_pct', (select case when amount = 0 then null
                                            else round((1 - cost / amount) * 100, 1)::text end from appr)
    ),
    'catalog', jsonb_build_object(
        'items', (select count(*) from public.catalog_items),
        'items_published', (select count(*) from public.catalog_items where in_published_catalog),
        'families', (select count(*) from public.catalog_families),
        'sizes', (select count(*) from public.catalog_sizes),
        'finishes', (select count(*) from public.finishes),
        'hardware', (select count(*) from public.catalog_hardware),
        'doors', (select count(*) from public.catalog_doors),
        'materials', (select count(*) from public.catalog_materials)
    ),
    'data_quality', (select coalesce(jsonb_agg(jsonb_build_object('check', q.check_name, 'found', q.found)), '[]'::jsonb)
        from meta.v_data_quality q)
)
$$;

comment on function public.dashboard_snapshot() is
    'Snapshot agregado del motor MUEBLESINTRA para el dashboard público. Solo agregados; sin datos personales.';

-- Superficie de anon: SOLO esta función.
revoke all on function public.dashboard_snapshot() from public;
grant execute on function public.dashboard_snapshot() to anon, authenticated;
revoke all on all sequences in schema public from anon;
-- Lo que se cree después en public (por postgres) ya no se concede solo a anon.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- Compuerta: si anon puede algo más que ejecutar dashboard_snapshot en public, la migración se revierte.
do $$
declare
    extra text;
begin
    select string_agg(x, ', ') into extra from (
        select 'table ' || c.relname as x from pg_catalog.pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
          and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
            or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
        union all
        select 'sequence ' || c.relname from pg_catalog.pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
          and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'SELECT')
            or has_sequence_privilege('anon', c.oid, 'UPDATE'))
        union all
        select 'function ' || p.oid::regprocedure::text from pg_catalog.pg_proc p
        where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')
          and p.oid <> 'public.dashboard_snapshot()'::regprocedure
    ) s;
    if extra is not null then
        raise exception 'anon tiene privilegios de más en public: %', extra;
    end if;
    if not has_function_privilege('anon', 'public.dashboard_snapshot()', 'EXECUTE') then
        raise exception 'anon no puede ejecutar dashboard_snapshot()';
    end if;
end;
$$;

-- PostgREST recarga su caché de esquema para exponer la función de inmediato.
notify pgrst, 'reload schema';
