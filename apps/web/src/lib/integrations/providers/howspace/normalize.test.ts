import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHowspaceStats, parseHowspaceWorkspace } from '@platform/shared';
import { normalizeWorkspace, normalizeWorkspaceStats } from './normalize';

const raw = {
  id: 'ws-42',
  name: 'Boost Chamber 2026',
  description: 'Programmets gemensamma arbetsyta för kohorten.',
  status: 'active',
  participantCount: 18,
  updatedAt: '2026-10-05T10:00:00Z'
};

test('normalizeWorkspace whitelistar payload och bygger länk utan PII', () => {
  const ws = parseHowspaceWorkspace(raw);
  assert.ok(ws);
  const rec = normalizeWorkspace(ws, 'https://movexum.howspace.com');
  assert.equal(rec.externalId, 'ws-42');
  assert.equal(rec.recordType, 'workspace');
  assert.equal(rec.title, 'Boost Chamber 2026');
  assert.equal(rec.url, 'https://movexum.howspace.com/workspace/ws-42');
  assert.equal(rec.occurredAt, '2026-10-05T10:00:00.000Z');
  assert.deepEqual(Object.keys(rec.payload).sort(), ['participantCount', 'status']);
});

test('normalizeWorkspace faller tillbaka på statusrad när beskrivning saknas', () => {
  const ws = parseHowspaceWorkspace({ id: 'x', name: 'Tom', status: 'draft' });
  assert.ok(ws);
  const rec = normalizeWorkspace(ws, 'https://app.howspace.com', '2026-01-01T00:00:00.000Z');
  assert.equal(rec.summary, 'Status: draft');
  assert.equal(rec.occurredAt, '2026-01-01T00:00:00.000Z');
});

test('normalizeWorkspaceStats bär bara räknare', () => {
  const ws = parseHowspaceWorkspace(raw);
  assert.ok(ws);
  const stats = parseHowspaceStats({ total: 20, active: 7, participants: [{ email: 'x@y.se' }] });
  const rec = normalizeWorkspaceStats(ws, stats, '2026-11-01T00:00:00.000Z');
  assert.equal(rec.externalId, 'ws-42:stats');
  assert.equal(rec.recordType, 'workspace_stats');
  assert.deepEqual(rec.payload, { total: 20, active: 7 });
  assert.equal(JSON.stringify(rec).includes('x@y.se'), false);
});
