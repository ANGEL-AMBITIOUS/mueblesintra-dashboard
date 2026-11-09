# MUEBLESINTRA · Motor de planta (dashboard en vivo)

Next.js (App Router) + React + TypeScript sobre Supabase `lxllqokwqbjlpwfvisat`. Cada sección sale de un área real del
motor: pedidos por estado, ruta de planta por estación, escaneos y bultos, inventario, costos/comercial, catálogo,
calidad de datos y salud del motor.

## Concepto
- **Propósito:** ver en un vistazo dónde está cada pedido y cada pieza de la planta, con los mismos números que el Excel.
- **Estado:** un snapshot agregado de `public.dashboard_snapshot()`; se vuelve a pedir cada 5 s ("actualizado hace X s").
- **Acciones:** filtrar pedidos por estado; reintentar si el motor no responde.
- **Principio operativo:** el navegador nunca toca tablas. Solo ejecuta una función `SECURITY DEFINER` con
  `search_path = ''` que devuelve agregados sin datos personales; las 28 tablas base conservan RLS.

## Datos y seguridad
- Migración: `supabase/migrations/20261109190000_dashboard_api.sql` (+ `.rollback.sql`). Revoca todo a `anon` en
  `public` salvo `EXECUTE` sobre `dashboard_snapshot()`, y falla si queda algo más.
- Dinero y porcentajes llegan como texto `numeric` redondeado en Postgres; `lib/kpis.ts` solo agrupa dígitos.
- Realtime no aplica: el rol anónimo no puede leer tablas (RLS), así que se usa polling de 5 s con timeout de 4 s.

## Pruebas
`node --test lib/kpis.test.ts` (también en GitHub Actions; Node 24 ejecuta TypeScript sin instalar nada).

## Docs
- Supabase + Next.js: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- API keys: https://supabase.com/docs/guides/api/api-keys
- Funciones (security definer): https://supabase.com/docs/guides/database/functions
- Vercel REST · proyectos: https://vercel.com/docs/rest-api/projects/create-a-new-project
- Vercel REST · variables: https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables
- Vercel REST · deployments: https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url
