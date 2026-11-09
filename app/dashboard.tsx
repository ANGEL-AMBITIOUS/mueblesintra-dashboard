'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engineClient, fetchSnapshot } from '@/lib/supabase';
import { ago, formatInt, formatMxn, formatPct, formatQty, headlineKpis, type Snapshot } from '@/lib/kpis';

const POLL_MS = 5000;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  'EN PRODUCCION': 'En producción',
  'LISTO PARA EMBARQUE': 'Listo para embarque',
  'SIN PIEZAS': 'Sin piezas',
};
const STATION_LABEL: Record<string, string> = {
  CORTE: 'Corte',
  CHAPEO: 'Chapeo',
  TALADRO: 'Taladro',
  PUERTAS: 'Puertas',
  ARMADO: 'Armado',
  EMPAQUE: 'Empaque',
};

// Mexico City has had no DST since 2022: UTC-6 all year. Deterministic on server and client (no ICU drift).
function cdmxTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(Date.parse(iso) - 6 * 3600_000).toISOString().slice(11, 19);
}
function cdmxDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(Date.parse(iso) - 6 * 3600_000).toISOString();
  return `${shortDate(d.slice(0, 10))} ${d.slice(11, 16)}`;
}
function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

type Props = { initial: Snapshot | null; initialError: string | null; renderedAt: number };

export default function Dashboard({ initial, initialError, renderedAt }: Props) {
  const client = useMemo(() => engineClient(), []);
  const [snap, setSnap] = useState<Snapshot | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [fetchedAt, setFetchedAt] = useState<number>(renderedAt);
  const [now, setNow] = useState<number>(renderedAt);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!client || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const next = await fetchSnapshot(client);
      setSnap(next);
      setError(null);
      setFetchedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!initial) void load();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [initial, load]);

  const stale = error !== null && snap !== null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">MUEBLESINTRA</span>
          <span className="subtitle">Motor de planta · simulación sobre el Excel de Intratta</span>
        </div>
        <div className={`live ${stale ? 'live-stale' : ''}`} data-testid="live">
          <span className="dot" aria-hidden="true" />
          <span>
            {stale ? 'Sin conexión, reintentando' : 'En vivo'} · actualizado{' '}
            <strong data-testid="ago">{ago(now, fetchedAt)}</strong>
          </span>
          <span className="muted">
            dato del motor {cdmxTime(snap?.generated_at ?? null)} CDMX{loading ? ' · consultando…' : ''}
          </span>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {error ? `Error al consultar el motor: ${error}` : ''}
      </p>

      {error && (
        <div className="banner" role="alert">
          <span>
            {snap ? 'No se pudo actualizar; se muestra el último dato válido.' : 'No se pudo leer el motor.'} Detalle: {error}
          </span>
          <button type="button" className="btn" onClick={() => void load()} disabled={loading || !client}>
            Reintentar
          </button>
        </div>
      )}

      {!snap ? (
        error ? null : (
          <div className="loading" role="status">
            Cargando el motor…
          </div>
        )
      ) : (
        <Content snap={snap} />
      )}

      <footer className="foot">
        Fuente: Supabase <code>lxllqokwqbjlpwfvisat</code> · función <code>public.dashboard_snapshot()</code> (solo
        agregados) · RLS en las 28 tablas base · consulta cada 5 s (Realtime no aplica: el rol anónimo no lee tablas).
      </footer>
    </div>
  );
}

function Content({ snap }: { snap: Snapshot }) {
  const [filter, setFilter] = useState<string>('TODOS');
  const kpis = headlineKpis(snap);
  const orders = filter === 'TODOS' ? snap.orders : snap.orders.filter((o) => o.status === filter);
  const notStarted = snap.parts_by_status.find((p) => p.status === 'SIN INICIAR')?.n ?? 0;
  const rejected = snap.parts_by_status.find((p) => p.status === 'RECHAZADA - RECORTE')?.n ?? 0;
  const packed = snap.parts_by_status.find((p) => p.status === 'EMPACADA')?.n ?? 0;

  return (
    <main>
      <section aria-labelledby="kpi-h" className="kpis-wrap">
        <h2 id="kpi-h" className="sr-only">
          Indicadores
        </h2>
        <dl className="kpis">
          {kpis.map((k) => (
            <div key={k.id} className="kpi" data-kpi={k.id}>
              <dt>{k.label}</dt>
              <dd className="num">{k.value}</dd>
              <dd className="note">{k.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="route-h" className="panel">
        <div className="panel-head">
          <h2 id="route-h">Ruta de planta</h2>
          <p className="muted">Piezas activas por estación, según su último escaneo válido</p>
        </div>
        <ol className="route">
          <li className="stop stop-edge">
            <span className="stop-name">Sin iniciar</span>
            <span className="stop-n num">{formatInt(notStarted)}</span>
            <span className="stop-meta">piezas sin escaneo</span>
          </li>
          {snap.stations.map((s) => {
            const t = s.tasks;
            return (
              <li key={s.code} className="stop" data-station={s.code}>
                <span className="stop-name">
                  {s.seq}. {STATION_LABEL[s.code] ?? s.code}
                </span>
                <span className="stop-n num">{formatInt(s.wip_parts)}</span>
                <span className="stop-meta">
                  en estación · <span className="num">{formatInt(s.valid_scans)}</span> escaneos
                  {s.rejects > 0 && (
                    <>
                      {' '}
                      · <span className="warn num">{formatInt(s.rejects)} rechazo{s.rejects === 1 ? '' : 's'}</span>
                    </>
                  )}
                </span>
                <span className="stop-tasks">
                  Tareas: <span className="num">{t.done}</span> hechas · <span className="num">{t.in_progress}</span> en
                  curso · <span className="num">{t.pending}</span> pendientes
                  {t.waiting_handoff > 0 && (
                    <>
                      {' '}
                      · <span className="num">{t.waiting_handoff}</span> en relevo
                    </>
                  )}
                </span>
              </li>
            );
          })}
          <li className="stop stop-edge stop-end">
            <span className="stop-name">Empacadas</span>
            <span className="stop-n num">{formatInt(packed)}</span>
            <span className="stop-meta">
              listas por bulto{rejected > 0 ? ` · ${formatInt(rejected)} en recorte` : ''}
            </span>
          </li>
        </ol>
      </section>

      <div className="grid">
        <section aria-labelledby="orders-h" className="panel span-8">
          <div className="panel-head">
            <h2 id="orders-h">Pedidos</h2>
            <div className="chips" role="group" aria-label="Filtrar pedidos por estado">
              <button type="button" className="chip" aria-pressed={filter === 'TODOS'} onClick={() => setFilter('TODOS')}>
                Todos <span className="num">{formatInt(snap.orders.length)}</span>
              </button>
              {snap.orders_by_status
                .filter((s) => s.n > 0)
                .map((s) => (
                  <button
                    key={s.status}
                    type="button"
                    className="chip"
                    aria-pressed={filter === s.status}
                    onClick={() => setFilter(s.status)}
                  >
                    {ORDER_STATUS_LABEL[s.status] ?? s.status} <span className="num">{formatInt(s.n)}</span>
                  </button>
                ))}
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Pedido</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="r">
                    Avance
                  </th>
                  <th scope="col" className="r">
                    Piezas
                  </th>
                  <th scope="col" className="r">
                    Escaneos
                  </th>
                  <th scope="col" className="r">
                    Bultos
                  </th>
                  <th scope="col" className="r">
                    Material
                  </th>
                  <th scope="col">Compromiso</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      Ningún pedido en este estado.{' '}
                      <button type="button" className="link" onClick={() => setFilter('TODOS')}>
                        Ver todos
                      </button>
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.code} data-order={o.code}>
                      <th scope="row" className="code">
                        {o.code}
                      </th>
                      <td>
                        <span className={`pill pill-${o.status.replace(/\s+/g, '-').toLowerCase()}`}>
                          {ORDER_STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="r">
                        <span className="bar" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, Number(o.progress_pct))}%` }} />
                        </span>
                        <span className="num">{formatPct(o.progress_pct)}</span>
                      </td>
                      <td className="r num">
                        {formatInt(o.packed_parts)} / {formatInt(o.active_parts)}
                      </td>
                      <td className="r num">{formatInt(o.valid_scans)}</td>
                      <td className="r num">
                        {formatInt(o.packages_complete)} / {formatInt(o.packages_applicable)}
                        <span className="sub"> · {formatInt(o.packages_delivered)} entreg.</span>
                      </td>
                      <td className="r num">{formatMxn(o.material_cost_mxn)}</td>
                      <td className="num">{shortDate(o.promised_on)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="quotes-h" className="panel span-4">
          <div className="panel-head">
            <h2 id="quotes-h">Comercial</h2>
            <p className="muted">Cotizaciones por estado (total con IVA)</p>
          </div>
          <table>
            <tbody>
              {snap.quotes.by_status.map((q) => (
                <tr key={q.status}>
                  <th scope="row">{q.status.charAt(0) + q.status.slice(1).toLowerCase()}</th>
                  <td className="r num">{formatInt(q.n)}</td>
                  <td className="r num">{formatMxn(q.total_mxn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="pairs">
            <div>
              <dt>Subtotal aprobado</dt>
              <dd className="num">{formatMxn(snap.quotes.approved_amount_mxn)}</dd>
            </div>
            <div>
              <dt>Costo aprobado</dt>
              <dd className="num">{formatMxn(snap.quotes.approved_cost_mxn)}</dd>
            </div>
            <div>
              <dt>Margen bruto</dt>
              <dd className="num">{formatPct(snap.quotes.approved_margin_pct)}</dd>
            </div>
          </dl>
          <h3 className="h3">Ciclo del proyecto</h3>
          <ol className="lifecycle">
            {snap.quotes.lifecycle.map((l) => (
              <li key={l.status} className={l.n === 0 ? 'zero' : ''}>
                <span>{l.status.charAt(0) + l.status.slice(1).toLowerCase()}</span>
                <span className="num">{formatInt(l.n)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="inv-h" className="panel span-7">
          <div className="panel-head">
            <h2 id="inv-h">Inventario</h2>
            <p className="muted">
              Existencia = suma de movimientos · valor total{' '}
              <strong className="num">{formatMxn(snap.inventory.total_value_mxn)}</strong>
            </p>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Material</th>
                  <th scope="col" className="r">
                    Existencia
                  </th>
                  <th scope="col" className="r">
                    Punto de reorden
                  </th>
                  <th scope="col" className="r">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {snap.inventory.items.map((i) => (
                  <tr key={i.code}>
                    <th scope="row" className="code">
                      {i.code}
                    </th>
                    <td className={`r num ${i.at_or_below_reorder ? 'warn' : ''}`}>
                      {formatQty(i.stock)} {i.unit === 'HOJA' ? 'hojas' : 'm'}
                      {i.at_or_below_reorder && <span className="sub"> · en o bajo reorden</span>}
                    </td>
                    <td className="r num">{formatQty(i.reorder_point)}</td>
                    <td className="r num">{formatMxn(i.value_mxn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="scan-h" className="panel span-5">
          <div className="panel-head">
            <h2 id="scan-h">Escaneos y bultos</h2>
            <p className="muted">Último escaneo {cdmxDateTime(snap.scans.last_scan_at)} CDMX</p>
          </div>
          <dl className="pairs">
            <div>
              <dt>Escaneos registrados</dt>
              <dd className="num">{formatInt(snap.scans.total)}</dd>
            </div>
            <div>
              <dt>Válidos</dt>
              <dd className="num">{formatInt(snap.scans.valid)}</dd>
            </div>
            <div>
              <dt>Duplicados (ventana 5 min)</dt>
              <dd className={`num ${snap.scans.duplicate ? 'warn' : ''}`}>{formatInt(snap.scans.duplicate)}</dd>
            </div>
            <div>
              <dt>Etiqueta inexistente</dt>
              <dd className={`num ${snap.scans.invalid_label ? 'warn' : ''}`}>{formatInt(snap.scans.invalid_label)}</dd>
            </div>
            <div>
              <dt>Bultos completos</dt>
              <dd className="num ok">{formatInt(snap.packages.complete)}</dd>
            </div>
            <div>
              <dt>Bultos incompletos</dt>
              <dd className="num">{formatInt(snap.packages.incomplete)}</dd>
            </div>
            <div>
              <dt>Entregas registradas</dt>
              <dd className="num">{formatInt(snap.packages.deliveries)}</dd>
            </div>
            <div>
              <dt>Bultos entregados</dt>
              <dd className="num">{formatInt(snap.packages.delivered_packages)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="cat-h" className="panel span-4">
          <div className="panel-head">
            <h2 id="cat-h">Catálogo publicado</h2>
          </div>
          <dl className="pairs">
            <div>
              <dt>Familias</dt>
              <dd className="num">{formatInt(snap.catalog.families)}</dd>
            </div>
            <div>
              <dt>Medidas</dt>
              <dd className="num">{formatInt(snap.catalog.sizes)}</dd>
            </div>
            <div>
              <dt>Acabados</dt>
              <dd className="num">{formatInt(snap.catalog.finishes)}</dd>
            </div>
            <div>
              <dt>Herrajes</dt>
              <dd className="num">{formatInt(snap.catalog.hardware)}</dd>
            </div>
            <div>
              <dt>Puertas</dt>
              <dd className="num">{formatInt(snap.catalog.doors)}</dd>
            </div>
            <div>
              <dt>SKU cotizables</dt>
              <dd className="num">
                {formatInt(snap.catalog.items)}
                <span className="sub"> · {formatInt(snap.catalog.items_published)} publicados</span>
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="dq-h" className="panel span-4">
          <div className="panel-head">
            <h2 id="dq-h">Calidad de datos</h2>
            <p className="muted">Hallazgos que el motor detecta en los datos fuente</p>
          </div>
          <ul className="checks">
            {snap.data_quality.map((q) => (
              <li key={q.check}>
                <span>{q.check}</span>
                <span className={`num ${q.found > 0 ? 'warn' : 'ok'}`}>{formatInt(q.found)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="eng-h" className="panel span-4">
          <div className="panel-head">
            <h2 id="eng-h">Motor</h2>
            <p className="muted">Integridad de la carga y de la seguridad</p>
          </div>
          <dl className="pairs">
            <div>
              <dt>Filas del Excel cargadas</dt>
              <dd className="num">{formatInt(snap.engine.excel_rows)}</dd>
            </div>
            <div>
              <dt>Hojas con destino</dt>
              <dd className="num">{formatInt(snap.engine.excel_sheets)}</dd>
            </div>
            <div>
              <dt>Tablas con RLS</dt>
              <dd className="num ok">
                {formatInt(snap.engine.tables_public_rls)} / {formatInt(snap.engine.tables_public)}
              </dd>
            </div>
            <div>
              <dt>Políticas RLS</dt>
              <dd className="num">{formatInt(snap.engine.policies_public)}</dd>
            </div>
            <div>
              <dt>Pruebas por rol</dt>
              <dd className="num ok">
                {formatInt(snap.engine.selftest_passed)} / {formatInt(snap.engine.selftest_probes)}
              </dd>
            </div>
            <div>
              <dt>Huella del archivo</dt>
              <dd className="code">sha256 {snap.engine.source_sha256_12}…</dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}
