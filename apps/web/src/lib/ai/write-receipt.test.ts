import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionReceipt,
  isInternalHref,
  isWriteTool,
  receiptTotals,
  summarizeReceiptsForModel
} from './write-receipt';

test('läs- och UX-verktyg ger inget kvitto', () => {
  for (const tool of ['query_collection', 'search_records', 'request_approval', 'generate_document']) {
    assert.equal(isWriteTool(tool), false);
    assert.equal(
      buildActionReceipt({ tool, label: 'x', args: {}, result: { ok: true, data: { id: 'a' } } }),
      null
    );
  }
});

test('lyckad årshjulsserie → kvitto med id:n, sammanfattning och /arshjul-länk', () => {
  const r = buildActionReceipt({
    tool: 'create_annual_wheel_item',
    label: 'Lägger till i årshjulet',
    args: { title: 'Nyhetsbrev', year: 2026, month: 1, repeat: 'quarterly', category: 'ledning' },
    result: {
      ok: true,
      data: { item_ids: ['abc123', 'def456'], created: 2, months: [1, 4], years: [2026] }
    }
  });
  assert.ok(r);
  assert.equal(r.ok, true);
  assert.deepEqual(r.record_ids, ['abc123', 'def456']);
  assert.equal(r.href, '/arshjul?item=abc123');
  assert.equal(r.summary, 'Nyhetsbrev · 2 poster · jan, apr · 2026');
  assert.equal(r.error, undefined);
});

test('misslyckad skrivning → ok:false med skrivlagrets fel, aldrig länk eller id', () => {
  const r = buildActionReceipt({
    tool: 'create_annual_wheel_item',
    label: 'Lägger till i årshjulet',
    args: { title: 'Checklista', year: 2026 },
    result: { ok: false, error: "Okänd kategori 'x'. Giltiga kategorier: styrelse, ledning." }
  });
  assert.ok(r);
  assert.equal(r.ok, false);
  assert.equal(r.error, "Okänd kategori 'x'. Giltiga kategorier: styrelse, ledning.");
  assert.equal(r.summary, 'Checklista');
  assert.equal(r.href, undefined);
  assert.equal(r.record_ids, undefined);
});

test('helårsaktivitet utan månad märks "helår"; varning följer med', () => {
  const r = buildActionReceipt({
    tool: 'create_annual_wheel_item',
    label: 'Lägger till i årshjulet',
    args: { title: 'Årsplan', year: 2027 },
    result: {
      ok: true,
      data: { item_ids: ['z1'], created: 1, months: [], years: [2027] },
      warning: 'Databasschemat saknar fälten day, tags.'
    }
  });
  assert.ok(r);
  assert.equal(r.summary, 'Årsplan · 1 post · helår · 2027');
  assert.equal(r.warning, 'Databasschemat saknar fälten day, tags.');
});

test('fältuppdatering sammanfattas som före → efter', () => {
  const r = buildActionReceipt({
    tool: 'update_annual_wheel_item',
    label: 'Uppdaterar årshjulet',
    args: { itemId: 'q9', field: 'month', value: 4 },
    result: { ok: true, data: { item_id: 'q9', field: 'month', before: 3, after: 4 } }
  });
  assert.ok(r);
  assert.equal(r.summary, 'month: 3 → 4');
  assert.equal(r.href, '/arshjul?item=q9');
  assert.deepEqual(r.record_ids, ['q9']);
});

test('generiska skrivverktyg tar länk ur path/board_path och namn ur data', () => {
  const task = buildActionReceipt({
    tool: 'create_task',
    label: 'Skapar kanban-kort',
    args: { title: 'Ring investerare' },
    result: { ok: true, data: { task_id: 't1', status: 'open', board_path: '/startups/s1/aktiviteter' } }
  });
  assert.ok(task);
  assert.equal(task.href, '/startups/s1/aktiviteter');
  assert.equal(task.summary, 'Ring investerare');

  const kpi = buildActionReceipt({
    tool: 'add_startup_kpi',
    label: 'Lägger till KPI',
    args: {},
    result: { ok: true, data: { kpi_id: 'k1', kpi_name: 'MRR', startup: 'Fixkod AB', path: '/startups/s1' } }
  });
  assert.ok(kpi);
  assert.equal(kpi.summary, 'MRR · Fixkod AB');
  assert.equal(kpi.href, '/startups/s1');
});

test('externa/protokoll-relativa länkar släpps aldrig igenom', () => {
  assert.equal(isInternalHref('/arshjul'), true);
  assert.equal(isInternalHref('//evil.example'), false);
  assert.equal(isInternalHref('https://evil.example'), false);
  const r = buildActionReceipt({
    tool: 'create_event',
    label: 'Bokar event',
    args: {},
    result: { ok: true, data: { event_id: 'e1', path: 'https://evil.example/x' } }
  });
  assert.ok(r);
  assert.equal(r.href, undefined);
});

test('långa fel och titlar cappas', () => {
  const r = buildActionReceipt({
    tool: 'create_startup_note',
    label: 'Skriver anteckning',
    args: { title: 'x'.repeat(500) },
    result: { ok: false, error: 'y'.repeat(2000) }
  });
  assert.ok(r);
  assert.ok((r.error ?? '').length <= 400);
  assert.ok((r.summary ?? '').length <= 80);
});

test('totaler och modell-sammanfattning speglar det faktiska utfallet', () => {
  const receipts = [
    buildActionReceipt({
      tool: 'create_annual_wheel_item',
      label: 'Lägger till i årshjulet',
      args: { title: 'A' },
      result: { ok: true, data: { item_ids: ['1'], created: 1, months: [4], years: [2026] } }
    }),
    buildActionReceipt({
      tool: 'create_annual_wheel_item',
      label: 'Lägger till i årshjulet',
      args: { title: 'B' },
      result: { ok: false, error: 'Okänd kategori' }
    }),
    buildActionReceipt({
      tool: 'create_annual_wheel_item',
      label: 'Lägger till i årshjulet',
      args: { title: 'C' },
      result: { ok: true, data: { item_ids: ['3'], created: 1, months: [5], years: [2026] }, warning: 'drift' }
    })
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  assert.deepEqual(receiptTotals(receipts), { total: 3, succeeded: 2, failed: 1, partial: 1 });
  const text = summarizeReceiptsForModel(receipts);
  assert.match(text, /2 av 3 sparades, 1 misslyckades/);
  assert.match(text, /✕ INTE SPARAT: Lägger till i årshjulet — B \(fel: Okänd kategori\)/);
  assert.match(text, /✓ SPARAT: Lägger till i årshjulet — C · 1 post · maj · 2026 \(varning: drift\)/);
  assert.equal(summarizeReceiptsForModel([]), '');
});
