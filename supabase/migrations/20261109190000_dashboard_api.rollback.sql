-- Rollback de la migración 5: quita la API del dashboard y restaura los privilegios por defecto de Supabase para anon.
drop function if exists public.dashboard_snapshot();
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant all on functions to anon;
grant usage, select, update on all sequences in schema public to anon;
notify pgrst, 'reload schema';
