import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHowspaceWorkspaceViews,
  extractHowspaceList,
  howspaceStatusLabel,
  howspaceWorkspaceUrl,
  parseHowspaceStats,
  parseHowspaceWorkspace,
  safeHowspaceUrl
} from './howspace';

test('extractHowspaceList tar listan ur array eller kuvert', () => {
  assert.deepEqual(extractHowspaceList([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(extractHowspaceList({ workspaces: [{ id: 'a' }] }), [{ id: 'a' }]);
  assert.deepEqual(extractHowspaceList({ data: { items: [{ id: 'b' }] } }), [{ id: 'b' }]);
  assert.deepEqual(extractHowspaceList({ results: [] }), []);
  assert.deepEqual(extractHowspaceList(null), []);
  assert.deepEqual(extractHowspaceList('nej'), []);
});

test('parseHowspaceWorkspace läser fält ur kandidatlistor och avvisar poster utan id', () => {
  const ws = parseHowspaceWorkspace({
    workspace_id: 'ws-1',
    title: 'Inkubatorprogram HT26',
    state: 'active',
    participant_count: '42',
    created_at: '2026-01-10T08:00:00Z',
    link: 'https://movexum.howspace.com/ws-1'
  });
  assert.ok(ws);
  assert.equal(ws.id, 'ws-1');
  assert.equal(ws.name, 'Inkubatorprogram HT26');
  assert.equal(ws.status, 'active');
  assert.equal(ws.participantCount, 42);
  assert.equal(ws.createdAt, '2026-01-10T08:00:00.000Z');
  assert.equal(ws.url, 'https://movexum.howspace.com/ws-1');
  assert.equal(parseHowspaceWorkspace({ name: 'utan id' }), null);
  assert.equal(parseHowspaceWorkspace('x'), null);
});

test('parseHowspaceWorkspace ger namn-fallback och släpper osäkra länkar', () => {
  const ws = parseHowspaceWorkspace({ id: 7, url: 'http://evil.example/ws' });
  assert.ok(ws);
  assert.equal(ws.name, 'Workspace 7');
  assert.equal(ws.url, null);
});

test('parseHowspaceStats läser bara räknare, även under data', () => {
  assert.deepEqual(parseHowspaceStats({ total: 10, active: 3 }), { total: 10, active: 3 });
  assert.deepEqual(parseHowspaceStats({ data: { totalParticipants: '12', activeCount: 5 } }), { total: 12, active: 5 });
  assert.deepEqual(parseHowspaceStats(null), { total: null, active: null });
  // Deltagarlistor tolkas aldrig som statistik.
  assert.deepEqual(parseHowspaceStats({ participants: [{ email: 'a@b.se' }] }), { total: null, active: null });
});

test('safeHowspaceUrl kräver https och Howspace-värd', () => {
  assert.equal(safeHowspaceUrl('https://app.howspace.com/workspace/1'), 'https://app.howspace.com/workspace/1');
  assert.equal(safeHowspaceUrl('https://movexum.howspace.com/'), 'https://movexum.howspace.com/');
  assert.equal(safeHowspaceUrl('http://app.howspace.com/x'), null);
  assert.equal(safeHowspaceUrl('https://howspace.com.evil.se/x'), null);
  assert.equal(safeHowspaceUrl('javascript:alert(1)'), null);
  assert.equal(safeHowspaceUrl(''), null);
  assert.equal(safeHowspaceUrl(undefined), null);
});

test('howspaceWorkspaceUrl föredrar leverantörens länk, annars appens väg', () => {
  assert.equal(howspaceWorkspaceUrl('a b', 'https://x.howspace.com/w', 'https://app.howspace.com'), 'https://x.howspace.com/w');
  assert.equal(howspaceWorkspaceUrl('a b', null, 'https://app.howspace.com/'), 'https://app.howspace.com/workspace/a%20b');
});

test('buildHowspaceWorkspaceViews slår ihop workspace + stats och sorterar på namn', () => {
  const views = buildHowspaceWorkspaceViews([
    {
      record_type: 'workspace',
      external_id: 'b',
      title: 'Boost Chamber',
      summary: 'Status: active',
      url: 'https://app.howspace.com/workspace/b',
      occurred_at: '2026-10-01T00:00:00Z',
      payload: { status: 'active', participantCount: 9 }
    },
    {
      record_type: 'workspace_stats',
      external_id: 'b:stats',
      occurred_at: '2026-11-01T00:00:00Z',
      payload: { total: 12, active: 4 }
    },
    { record_type: 'workspace', external_id: 'a', title: 'Alumni', url: 'http://osäker', payload: {} },
    { record_type: 'workspace', external_id: 'a', title: 'Dubblett' },
    { record_type: 'workspace_stats', external_id: 'orphan:stats', payload: { total: 1 } }
  ]);
  assert.deepEqual(
    views.map((v) => v.id),
    ['a', 'b']
  );
  const b = views[1];
  assert.equal(b.participantCount, 12);
  assert.equal(b.activeCount, 4);
  assert.equal(b.statsAt, '2026-11-01T00:00:00Z');
  assert.equal(b.url, 'https://app.howspace.com/workspace/b');
  const a = views[0];
  assert.equal(a.url, null);
  assert.equal(a.participantCount, null);
  assert.equal(a.name, 'Alumni');
});

test('howspaceStatusLabel mappar kända statusar och visar okända som de är', () => {
  assert.deepEqual(howspaceStatusLabel('active'), { label: 'Aktiv', tone: 'green' });
  assert.deepEqual(howspaceStatusLabel('archived'), { label: 'Arkiverad', tone: 'archive' });
  assert.deepEqual(howspaceStatusLabel('draft'), { label: 'Utkast', tone: 'yellow' });
  assert.deepEqual(howspaceStatusLabel('beta'), { label: 'beta', tone: 'default' });
  assert.deepEqual(howspaceStatusLabel(''), { label: '', tone: 'default' });
});
