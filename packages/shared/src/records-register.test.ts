import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RECORD_TYPES,
  RECORD_TYPE_KEY_RE,
  buildArchiveInventory,
  cleanRegisterText,
  disposalDueDate,
  findSequenceGaps,
  formatCaseNumber,
  formatEntryDesignation,
  nextSequence,
  normalizeArchiveDescription,
  registerCsvCell,
  registerEntryHashPayload,
  registerSourceHref,
  runRegisterAudit,
  summarizeAudit,
  validateDisclosureInput,
  validateManualEntryInput,
  validateRecordTypeInput,
  type AuditInput
} from './records-register';

test('standardplanen har unika, giltiga nycklar och klarar sin egen validering', () => {
  const keys = new Set<string>();
  for (const t of DEFAULT_RECORD_TYPES) {
    assert.ok(RECORD_TYPE_KEY_RE.test(t.key), t.key);
    assert.ok(!keys.has(t.key), `dubblett: ${t.key}`);
    keys.add(t.key);
    const v = validateRecordTypeInput(t);
    assert.ok(v.ok, `${t.key}: ${v.ok ? '' : v.error}`);
  }
  for (const k of ['lead_incoming', 'agreement_signed', 'support_check_application', 'support_check_decision', 'screening_final', 'procurement_opened']) {
    assert.ok(keys.has(k), `saknar ${k}`);
  }
});

test('sekretess kräver registrering, gallring kräver frist', () => {
  const base = { ...DEFAULT_RECORD_TYPES[0] };
  assert.equal(validateRecordTypeInput({ ...base, handling: 'ordered', secrecy_possible: true }).ok, false);
  assert.equal(validateRecordTypeInput({ ...base, retention: 'dispose', retention_months: null }).ok, false);
  const ok = validateRecordTypeInput({ ...base, retention: 'preserve', retention_months: 12 });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.value.retention_months, null);
});

test('diarienummer och löpnummer', () => {
  assert.equal(formatCaseNumber(2026, 42), '2026/0042');
  assert.equal(formatEntryDesignation('2026/0042', 3), '2026/0042-3');
  assert.equal(nextSequence([]), 1);
  assert.equal(nextSequence([1, 2, 7]), 8);
  assert.deepEqual(findSequenceGaps([1, 2, 3]), []);
  assert.deepEqual(findSequenceGaps([1, 3, 6]), [2, 4, 5]);
});

test('kontrollsummans underlag är stabilt oavsett nyckelordning', () => {
  const a = registerEntryHashPayload({ type_key: 't', title: 'x', direction: 'incoming', document_date: '2026-01-02T10:00:00Z', source_collection: 'c', source_id: '1', source_event: 'e', document_hash: '', snapshot: { b: 1, a: [{ d: 1, c: 2 }] } });
  const b = registerEntryHashPayload({ type_key: 't', title: 'x', direction: 'incoming', document_date: '2026-01-02', source_collection: 'c', source_id: '1', source_event: 'e', document_hash: '', snapshot: { a: [{ c: 2, d: 1 }], b: 1 } });
  assert.equal(a, b);
  assert.notEqual(a, registerEntryHashPayload({ type_key: 't', title: 'y', direction: 'incoming', document_date: '2026-01-02', source_collection: 'c', source_id: '1', source_event: 'e', document_hash: '', snapshot: { a: [{ c: 2, d: 1 }], b: 1 } }));
});

test('fritext tvättas från personnummer', () => {
  assert.equal(cleanRegisterText('Brev från 19800101-1234  om  stöd', 100), 'Brev från [REDACTED] om stöd');
});

test('manuell registrering valideras', () => {
  const today = '2026-11-24';
  assert.equal(validateManualEntryInput({ type_key: 'incoming_other', title: 'ab' }, today).ok, false);
  assert.equal(validateManualEntryInput({ type_key: 'incoming_other', title: 'Brev', document_date: '2027-01-01' }, today).ok, false);
  const v = validateManualEntryInput({ type_key: 'incoming_other', title: 'Brev från regionen', secrecy: 'on', secrecy_basis: 'OSL 19:1' }, today);
  assert.ok(v.ok);
  assert.equal(v.ok && v.value.document_date, today);
  assert.equal(v.ok && v.value.case_title, 'Brev från regionen');
});

test('utlämnande: nekat kräver lagrum', () => {
  assert.equal(validateDisclosureInput({ request_summary: 'Avtal X', outcome: 'denied' }, '2026-11-24').ok, false);
  assert.ok(validateDisclosureInput({ request_summary: 'Avtal X', outcome: 'released' }, '2026-11-24').ok);
});

test('gallringsfristen räknas från ärendets avslut', () => {
  assert.equal(disposalDueDate({ retention: 'dispose', retention_months: 24 }, null), null);
  assert.equal(disposalDueDate({ retention: 'preserve', retention_months: null }, '2026-01-15'), null);
  assert.equal(disposalDueDate({ retention: 'dispose', retention_months: 24 }, '2026-01-15 10:00:00.000Z'), '2028-01-15');
});

test('arkivförteckningen grupperar per process och räknar inte makulerade', () => {
  const inv = buildArchiveInventory(DEFAULT_RECORD_TYPES, [
    { type_key: 'lead_incoming', registered_at: '2026-03-01', secrecy: true, voided: false },
    { type_key: 'lead_incoming', registered_at: '2026-01-01', secrecy: false, voided: false },
    { type_key: 'lead_incoming', registered_at: '2026-02-01', secrecy: false, voided: true },
    { type_key: 'okand_typ', registered_at: '2026-02-01', secrecy: false, voided: false }
  ]);
  const inflow = inv.find((p) => p.process === 'Inflöde och antagning');
  assert.ok(inflow);
  assert.equal(inflow.rows[0].count, 2);
  assert.equal(inflow.rows[0].secrecy_count, 1);
  assert.equal(inflow.rows[0].first, '2026-01-01');
  assert.equal(inflow.rows[0].last, '2026-03-01');
  assert.ok(inv.some((p) => p.process === 'Saknas i planen' && p.count === 1));
  assert.ok(inv.some((p) => p.rows.some((r) => r.key === 'agreement_signed' && r.count === 0)));
});

test('källänkar byggs bara för giltiga id:n', () => {
  assert.equal(registerSourceHref('compass_leads', 'abc123'), '/inflode/leads/abc123');
  assert.equal(registerSourceHref('compass_leads', '../x'), null);
  assert.equal(registerSourceHref('agreements', 'abc', null), null);
});

test('CSV-celler neutraliserar formler', () => {
  assert.equal(registerCsvCell('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(registerCsvCell('a"b'), '"a""b"');
});

function auditBase(over: Partial<AuditInput> = {}): AuditInput {
  const desc = normalizeArchiveDescription({ organisation: 'a', history: 'b', records: 'c', search: 'd', secrecy: 'e', disposal: 'f', responsible: 'g' });
  return {
    types: DEFAULT_RECORD_TYPES.map((t) => ({ ...t, confirmed: true, active: true })),
    coverage: [{ source: 'agreements', expected: 3, registered: 3 }],
    caseSeqsByYear: { '2026': [1, 2, 3] },
    entries: { total: 3, withoutHash: 0, secrecyWithoutBasis: 0, disposalDue: 0, complete: true },
    disclosures: 1,
    description: desc,
    lastVersionAt: '2026-10-01',
    changedSinceVersion: false,
    writable: true,
    today: '2026-11-24',
    ...over
  };
}

test('granskningen: allt i ordning ger inga varningar eller fel', () => {
  const s = summarizeAudit(runRegisterAudit(auditBase()));
  assert.equal(s.fail, 0);
  assert.equal(s.warn, 0);
});

test('granskningen: fångar luckor, saknade registreringar, obekräftad plan och gammal version', () => {
  const checks = runRegisterAudit(
    auditBase({
      types: DEFAULT_RECORD_TYPES.map((t) => ({ ...t, confirmed: false, active: true })),
      coverage: [{ source: 'agreements', expected: 5, registered: 3 }],
      caseSeqsByYear: { '2026': [1, 3] },
      lastVersionAt: null,
      writable: false
    })
  );
  const by = Object.fromEntries(checks.map((c) => [c.key, c.status]));
  assert.equal(by.writable, 'fail');
  assert.equal(by.plan, 'warn');
  assert.equal(by.coverage, 'fail');
  assert.equal(by.sequence, 'fail');
  assert.equal(by.version, 'fail');
  assert.equal(runRegisterAudit(auditBase({ changedSinceVersion: true })).find((c) => c.key === 'version')?.status, 'warn');
  assert.equal(runRegisterAudit(auditBase({ lastVersionAt: '2025-01-01' })).find((c) => c.key === 'version')?.status, 'warn');
  assert.equal(runRegisterAudit(auditBase({ coverage: [{ source: 'agreements', expected: null, registered: null }] })).find((c) => c.key === 'coverage')?.status, 'warn');
});
