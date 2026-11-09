import Dashboard from './dashboard';
import { engineClient, fetchSnapshot } from '@/lib/supabase';
import type { Snapshot } from '@/lib/kpis';

// Rendered per request on the server (Node runtime) so the first paint already has live data.
export const dynamic = 'force-dynamic';

export default async function Page() {
  let initial: Snapshot | null = null;
  let initialError: string | null = null;
  const client = engineClient();
  if (!client) {
    initialError = 'Faltan las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.';
  } else {
    try {
      initial = await fetchSnapshot(client);
    } catch (e) {
      initialError = e instanceof Error ? e.message : String(e);
    }
  }
  return <Dashboard initial={initial} initialError={initialError} renderedAt={Date.now()} />;
}
