import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonalFeedItems, sortNewestFirst } from './personal-feed';

const ME = 'user_me_000000';
const OTHER = 'user_other_0000';

test('uppdrag: teammedlem, mentor och skapare får rätt du-form och tidpunkt', () => {
  const items = buildPersonalFeedItems({
    me: ME,
    missions: [
      {
        id: 'm1',
        title: 'Exportsatsning',
        issuer: OTHER,
        recipients: [ME],
        participants_json: [{ user_id: ME, role: 'contributor', added_at: '2026-09-20T10:00:00Z' }],
        created: '2026-06-01T00:00:00Z',
        expand: { startup: { id: 's1', name: 'Fixkod AB' } }
      },
      { id: 'm2', title: 'Mentorskap', issuer: OTHER, recipients: [], mentor: ME, created: '2026-09-01T00:00:00Z' },
      { id: 'm3', title: 'Mitt eget', issuer: ME, recipients: [OTHER], created: '2026-09-02T00:00:00Z' },
      { id: 'm4', title: 'Inte mitt', issuer: OTHER, recipients: [OTHER], created: '2026-09-03T00:00:00Z' }
    ]
  });
  assert.equal(items.length, 3);
  const team = items.find((i) => i.id === 'mission-m1')!;
  assert.equal(team.title, 'Du ingår i teamet för uppdraget "Exportsatsning"');
  assert.equal(team.detail, 'Fixkod AB');
  // Tidpunkten är när jag lades till i teamet, inte när uppdraget skapades.
  assert.equal(team.created, '2026-09-20T10:00:00Z');
  assert.equal(team.href, '/uppdrag/m1');
  assert.equal(items.find((i) => i.id === 'mission-m2')!.title, 'Du är mentor i uppdraget "Mentorskap"');
  assert.equal(items.find((i) => i.id === 'mission-m3')!.title, 'Du skapade uppdraget "Mitt eget"');
});

test('dedupe: poster som redan finns i skrivlagrets logg hoppas över', () => {
  const items = buildPersonalFeedItems({
    me: ME,
    loggedKeys: new Set(['tasks:t1', 'missions:m1', 'notes:n1']),
    tasks: [
      { id: 't1', description: 'Loggad av mig', owner: ME, created: '2026-09-10T00:00:00Z' },
      { id: 't2', description: 'Tilldelad mig', owner: OTHER, assignees: [ME], startup: 's1', created: '2026-09-11T00:00:00Z' },
      { id: 't3', description: 'Inte min', owner: OTHER, assignees: [OTHER], created: '2026-09-12T00:00:00Z' }
    ],
    missions: [{ id: 'm1', title: 'Skapat av mig', issuer: ME, created: '2026-09-01T00:00:00Z' }],
    notes: [{ id: 'n1', startup: 's1', created: '2026-09-01T00:00:00Z' }]
  });
  assert.deepEqual(
    items.map((i) => i.id),
    ['task-t2']
  );
  assert.equal(items[0].title, 'Uppgift till dig: "Tilldelad mig"');
  assert.equal(items[0].href, '/startups/s1/aktiviteter');
});

test('uppgifter länkar till uppdrag/upphandling/inkorg beroende på koppling', () => {
  const items = buildPersonalFeedItems({
    me: ME,
    tasks: [
      { id: 'a', description: 'x', owner: ME, mission: 'm9', created: '2026-09-01T00:00:00Z' },
      { id: 'b', description: 'y', owner: ME, procurement: 'p9', created: '2026-09-01T00:00:00Z' },
      { id: 'c', description: 'z', owner: ME, created: '2026-09-01T00:00:00Z' }
    ]
  });
  assert.deepEqual(
    items.map((i) => i.href),
    ['/uppdrag/m9', '/upphandlingar/p9', '/inkorg']
  );
});

test('filer, kunskapsbas, utbildningsdokument och agentkörningar', () => {
  const items = buildPersonalFeedItems({
    me: ME,
    userFiles: [
      { id: 'f1', filename: 'budget.xlsx', source: 'upload', created: '2026-09-05T00:00:00Z' },
      { id: 'f2', filename: 'rapport.pptx', source: 'agent_generated', created: '2026-09-06T00:00:00Z' }
    ],
    orgKnowledge: [{ id: 'k1', title: 'Processhandbok', created: '2026-09-07T00:00:00Z' }],
    educationDocuments: [{ id: 'e1', title: 'IRL-guide', created: '2026-09-08T00:00:00Z' }],
    toolRuns: [
      { id: 'r1', tool: 'tool1', created: '2026-09-09T00:00:00Z', expand: { tool: { name: 'Kvartalsrapport' }, startup: { name: 'Fixkod AB' } } },
      { id: 'r2', created: '2026-09-09T00:00:00Z' } // connector-chatt utan agent
    ]
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.equal(byId.get('file-f1')!.title, 'Du laddade upp filen "budget.xlsx"');
  assert.equal(byId.get('file-f1')!.icon, 'upload');
  assert.equal(byId.get('file-f2')!.title, 'Dokument genererat åt dig: "rapport.pptx"');
  assert.equal(byId.get('knowledge-k1')!.title, 'Du laddade upp "Processhandbok" till kunskapsbasen');
  assert.equal(byId.get('edudoc-e1')!.href, '/education/documents');
  assert.equal(byId.get('run-r1')!.title, 'Du körde agenten "Kvartalsrapport"');
  assert.equal(byId.get('run-r1')!.detail, 'Fixkod AB');
  assert.equal(byId.get('run-r1')!.href, '/toolbox/runs/r1');
  assert.equal(byId.has('run-r2'), false);
});

test('inbjudningar, tilldelningar och medarbetarskap', () => {
  const items = buildPersonalFeedItems({
    me: ME,
    eventSignups: [
      { id: 's1', event: 'ev1', created: '2026-09-01T00:00:00Z', expand: { event: { id: 'ev1', name: 'Demo Day', starts_at: '2026-10-02T12:00:00Z' } } }
    ],
    workshopAssignments: [
      { id: 'w1', assigned_by: ME, created: '2026-09-02T00:00:00Z', expand: { workshop: { title: 'Pitch' }, startup: { name: 'Fixkod AB' } } },
      { id: 'w2', assigned_by: OTHER, collaborators: [ME], created: '2026-09-03T00:00:00Z', expand: { workshop: { title: 'Sälj' } } },
      { id: 'w3', assigned_by: OTHER, collaborators: [OTHER], created: '2026-09-04T00:00:00Z' }
    ],
    documentAssignments: [
      { id: 'd1', assigned_by: OTHER, collaborators: [ME], startup: 's7', created: '2026-09-05T00:00:00Z', expand: { document: { title: 'Mall' } } }
    ],
    agreements: [
      { id: 'ag1', title: 'Inkubatoravtal', startup: 's7', sent_at: '2026-09-06T08:00:00Z', created: '2026-09-05T00:00:00Z' }
    ]
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.equal(byId.get('signup-s1')!.title, 'Du bjöds in till "Demo Day"');
  assert.equal(byId.get('signup-s1')!.href, '/events/ev1');
  assert.equal(byId.get('signup-s1')!.detail, '2 okt.');
  assert.equal(byId.get('wsassign-w1')!.title, 'Du tilldelade workshopen "Pitch"');
  assert.equal(byId.get('wsassign-w2')!.title, 'Du bjöds in som medarbetare på workshopen "Sälj"');
  assert.equal(byId.has('wsassign-w3'), false);
  assert.equal(byId.get('docassign-d1')!.title, 'Du bjöds in som medarbetare på dokumentet "Mall"');
  assert.equal(byId.get('docassign-d1')!.href, '/startups/s7');
  assert.equal(byId.get('agreement-ag1')!.created, '2026-09-06T08:00:00Z');
});

test('egna aktiviteter: workshop-tilldelning hoppas över (direkt rad finns), övriga visas', () => {
  const items = buildPersonalFeedItems({
    me: ME,
    activities: [
      { id: 'a1', title: 'Tilldelad workshop', kind: 'workshop_assignment', created: '2026-09-01T00:00:00Z' },
      { id: 'a2', title: 'Möte med teamet', kind: 'manual', created: '2026-09-02T00:00:00Z', expand: { startup: { id: 's1', name: 'Fixkod AB' } } }
    ]
  });
  assert.deepEqual(items.map((i) => i.id), ['act-a2']);
  assert.equal(items[0].href, '/startups/s1');
});

test('sortNewestFirst: nyast först, otolkbara tidsstämplar sist', () => {
  const sorted = sortNewestFirst([
    { id: 'old', created: '2026-01-01T00:00:00Z' },
    { id: 'bad', created: 'nope' },
    { id: 'new', created: '2026-09-01T00:00:00Z' }
  ]);
  assert.deepEqual(sorted.map((s) => s.id), ['new', 'old', 'bad']);
});
