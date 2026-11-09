// Run: node --test lib/kpis.test.ts   (Node 24 strips the types; no install needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ago, formatInt, formatMxn, formatPct, formatQty, headlineKpis, type Snapshot } from './kpis.ts';

const snap = JSON.parse(readFileSync(new URL('./fixtures/snapshot.json', import.meta.url), 'utf8')) as Snapshot;

test('money is formatted from the exact decimal string, never through a float', () => {
  assert.equal(formatMxn('217332.27'), '$217,332.27');
  assert.equal(formatMxn('17158.00'), '$17,158.00');
  assert.equal(formatMxn('0.5'), '$0.50');
  assert.equal(formatMxn('-444.41'), '-$444.41');
  assert.equal(formatMxn('1234567.8'), '$1,234,567.80');
  assert.equal(formatMxn('9007199254740993.01'), '$9,007,199,254,740,993.01'); // beyond 2^53: still exact
  assert.equal(formatMxn(null), '—');
});

test('integers, quantities and percents', () => {
  assert.equal(formatInt(1986), '1,986');
  assert.equal(formatInt(0), '0');
  assert.equal(formatQty('80.00'), '80');
  assert.equal(formatQty('12.50'), '12.5');
  assert.equal(formatPct('71.4'), '71.4%');
  assert.equal(formatPct('100.0'), '100%');
  assert.equal(formatPct(null), '—');
});

test('relative time for the live indicator', () => {
  assert.equal(ago(10_000, 10_000), 'hace 0 s');
  assert.equal(ago(15_400, 10_000), 'hace 5 s');
  assert.equal(ago(70_000, 10_000), 'hace 1 min');
  assert.equal(ago(5_000, 10_000), 'hace 0 s'); // clock skew never shows negatives
});

test('headline KPIs map the engine snapshot to the exact values the engine computed', () => {
  const k = Object.fromEntries(headlineKpis(snap).map((x) => [x.id, x.value]));
  assert.deepEqual(k, {
    orders: '4',
    progress: '71.4%',
    packed: '60 / 84',
    scans: '304 / 307',
    packages: '15 / 24',
    inventory: '$17,158.00',
    parts_cost: '$20,168.31',
    approved: '$58,500.75',
    margin: '31.8%',
    rls: '62 / 62',
  });
});
