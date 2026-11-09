// Pure mapping from the engine snapshot (public.dashboard_snapshot) to what the page shows.
// Money and percents arrive as decimal strings already rounded by Postgres numeric; they are only re-grouped here,
// never parsed into floats. Erasable TypeScript only, so `node --test` runs it without a build.

export type Count = { status: string; n: number };

export type Snapshot = {
  generated_at: string;
  engine: {
    excel_rows: number;
    excel_sheets: number;
    source_sha256_12: string;
    tables_public: number;
    tables_public_rls: number;
    policies_public: number;
    selftest_probes: number;
    selftest_passed: number;
    selftest_at: string;
  };
  totals: { orders: number; active_parts: number; packed_parts: number; progress_pct: string; parts_cost_mxn: string };
  orders: {
    code: string;
    promised_on: string;
    status: string;
    active_parts: number;
    packed_parts: number;
    progress_pct: string;
    valid_scans: number;
    material_cost_mxn: string;
    packages_applicable: number;
    packages_complete: number;
    packages_delivered: number;
  }[];
  orders_by_status: Count[];
  stations: {
    code: string;
    seq: number;
    wip_parts: number;
    valid_scans: number;
    rejects: number;
    tasks: { pending: number; in_progress: number; waiting_handoff: number; done: number; no_aplica: number };
  }[];
  parts_by_status: Count[];
  scans: { total: number; valid: number; duplicate: number; invalid_label: number; last_scan_at: string | null };
  packages: { complete: number; incomplete: number; not_applicable: number; deliveries: number; delivered_packages: number };
  inventory: {
    total_value_mxn: string;
    items: {
      code: string;
      kind: string;
      unit: string;
      stock: string;
      reorder_point: string;
      value_mxn: string;
      at_or_below_reorder: boolean;
    }[];
  };
  quotes: {
    by_status: (Count & { total_mxn: string })[];
    lifecycle: Count[];
    approved_amount_mxn: string;
    approved_cost_mxn: string;
    approved_margin_pct: string | null;
  };
  catalog: {
    items: number;
    items_published: number;
    families: number;
    sizes: number;
    finishes: number;
    hardware: number;
    doors: number;
    materials: number;
  };
  data_quality: { check: string; found: number }[];
};

export type Kpi = { id: string; label: string; value: string; note: string };

const DASH = '—';

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatInt(n: number): string {
  return group(String(Math.trunc(n)));
}

export function formatMxn(s: string | null | undefined): string {
  if (s == null || s === '') return DASH;
  const negative = s.startsWith('-');
  const [whole, frac = ''] = (negative ? s.slice(1) : s).split('.');
  return `${negative ? '-' : ''}$${group(whole)}.${(frac + '00').slice(0, 2)}`;
}

export function formatQty(s: string): string {
  if (!s.includes('.')) return group(s);
  const [whole, frac] = s.split('.');
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${group(whole)}.${trimmed}` : group(whole);
}

export function formatPct(s: string | null | undefined): string {
  if (s == null || s === '') return DASH;
  return `${formatQty(s)}%`;
}

export function ago(nowMs: number, thenMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  return seconds < 60 ? `hace ${seconds} s` : `hace ${Math.floor(seconds / 60)} min`;
}

export function headlineKpis(s: Snapshot): Kpi[] {
  const approved = s.quotes.by_status.find((q) => q.status === 'APROBADA');
  const applicable = s.packages.complete + s.packages.incomplete;
  return [
    { id: 'orders', label: 'Pedidos', value: formatInt(s.totals.orders), note: 'en planta' },
    { id: 'progress', label: 'Avance global', value: formatPct(s.totals.progress_pct), note: 'piezas empacadas / activas' },
    {
      id: 'packed',
      label: 'Piezas empacadas',
      value: `${formatInt(s.totals.packed_parts)} / ${formatInt(s.totals.active_parts)}`,
      note: 'de las activas',
    },
    {
      id: 'scans',
      label: 'Escaneos válidos',
      value: `${formatInt(s.scans.valid)} / ${formatInt(s.scans.total)}`,
      note: `${formatInt(s.scans.duplicate)} duplicados, ${formatInt(s.scans.invalid_label)} etiqueta inexistente`,
    },
    {
      id: 'packages',
      label: 'Bultos completos',
      value: `${formatInt(s.packages.complete)} / ${formatInt(applicable)}`,
      note: `${formatInt(s.packages.delivered_packages)} entregados`,
    },
    { id: 'inventory', label: 'Valor de inventario', value: formatMxn(s.inventory.total_value_mxn), note: 'existencia × costo' },
    { id: 'parts_cost', label: 'Costo de material', value: formatMxn(s.totals.parts_cost_mxn), note: 'suma del despiece' },
    { id: 'approved', label: 'Cotizado aprobado', value: formatMxn(approved?.total_mxn), note: 'con IVA' },
    { id: 'margin', label: 'Margen bruto aprobado', value: formatPct(s.quotes.approved_margin_pct), note: '1 − costo / subtotal' },
    {
      id: 'rls',
      label: 'Pruebas RLS',
      value: `${formatInt(s.engine.selftest_passed)} / ${formatInt(s.engine.selftest_probes)}`,
      note: `${formatInt(s.engine.tables_public_rls)}/${formatInt(s.engine.tables_public)} tablas con RLS`,
    },
  ];
}
