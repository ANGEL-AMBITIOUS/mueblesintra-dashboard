import { createClient } from '@supabase/supabase-js';
import type { Snapshot } from './kpis';

// Publishable key only (RLS guards every base table; anon may only EXECUTE public.dashboard_snapshot()).
// https://supabase.com/docs/guides/api/api-keys
export function engineClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type EngineClient = NonNullable<ReturnType<typeof engineClient>>;

// One bounded call: abort after 4 s so a slow request never stacks under the 5 s poll.
export async function fetchSnapshot(client: EngineClient): Promise<Snapshot> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const { data, error } = await client.rpc('dashboard_snapshot').abortSignal(ctrl.signal);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('El motor respondió sin datos');
    return data as Snapshot;
  } finally {
    clearTimeout(timer);
  }
}
