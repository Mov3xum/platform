import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canEditOrgPost,
  canRolesSeeOrgPost,
  isOrgPostLive,
  isSafeOrgPostLink,
  orgPostExcerpt,
  orgPostTabFor,
  orgPostTabFromSlug,
  orgPostHomePath,
  selectLiveOrgPosts,
  sortOrgPosts,
  validateOrgPostInput,
  type OrgPost
} from './org-posts';

function post(over: Partial<OrgPost>): OrgPost {
  return {
    id: 'p',
    tenant: 't',
    author: 'u1',
    title: 'Rubrik',
    body: 'Text',
    kind: 'news',
    audience: 'staff',
    pinned: false,
    created: '2026-09-01T08:00:00.000Z',
    ...over
  };
}

test('validateOrgPostInput trimmar, normaliserar och avvisar tomma rubriker', () => {
  const bad = validateOrgPostInput({ title: '   ', body: 'x' });
  assert.equal(bad.ok, false);
  const ok = validateOrgPostInput({
    title: '  Nytt bolag i portföljen  ',
    body: 'Rad 1\r\nRad 2',
    kind: 'celebration',
    audience: 'all',
    pinned: 'on',
    published_at: '2026-09-09',
    expires_at: '2026-09-20',
    link_url: '/startups/abc'
  });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.value.title, 'Nytt bolag i portföljen');
  assert.equal(ok.value.body, 'Rad 1\nRad 2');
  assert.equal(ok.value.kind, 'celebration');
  assert.equal(ok.value.audience, 'all');
  assert.equal(ok.value.pinned, true);
  assert.ok(ok.value.published_at?.startsWith('2026-09-0'));
  assert.equal(ok.value.link_url, '/startups/abc');
});

test('validateOrgPostInput avvisar okänd typ, fel datumordning och osäkra länkar', () => {
  assert.equal(validateOrgPostInput({ title: 'x', kind: 'gossip' }).ok, false);
  assert.equal(
    validateOrgPostInput({ title: 'x', published_at: '2026-09-10', expires_at: '2026-09-09' }).ok,
    false
  );
  assert.equal(validateOrgPostInput({ title: 'x', link_url: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateOrgPostInput({ title: 'x', link_url: 'http://example.com' }).ok, false);
  assert.equal(validateOrgPostInput({ title: 'x', published_at: 'igår' }).ok, false);
  // Default-värden när fälten saknas.
  const def = validateOrgPostInput({ title: 'x' });
  assert.ok(def.ok);
  if (def.ok) {
    assert.equal(def.value.kind, 'news');
    assert.equal(def.value.audience, 'staff');
    assert.equal(def.value.pinned, false);
    assert.equal(def.value.link_url, null);
  }
});

test('isSafeOrgPostLink tillåter interna sökvägar och https, inget annat', () => {
  assert.ok(isSafeOrgPostLink(''));
  assert.ok(isSafeOrgPostLink('/arshjul'));
  assert.ok(isSafeOrgPostLink('https://movexum.se/nyheter'));
  assert.ok(!isSafeOrgPostLink('//evil.example'));
  assert.ok(!isSafeOrgPostLink('data:text/html,hej'));
  assert.ok(!isSafeOrgPostLink('https://x y'));
});

test('isOrgPostLive respekterar schemalagd publicering och utgång', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  assert.ok(isOrgPostLive(post({}), now));
  assert.ok(!isOrgPostLive(post({ published_at: '2026-09-10T00:00:00Z' }), now));
  assert.ok(isOrgPostLive(post({ published_at: '2026-09-09T00:00:00Z' }), now));
  assert.ok(!isOrgPostLive(post({ expires_at: '2026-09-09T11:59:00Z' }), now));
  assert.ok(isOrgPostLive(post({ expires_at: '2026-09-09T12:01:00Z' }), now));
});

test('canRolesSeeOrgPost: staff/observer ser allt, ren medlem bara audience=all', () => {
  assert.ok(canRolesSeeOrgPost(['coach'], post({ audience: 'staff' })));
  assert.ok(canRolesSeeOrgPost(['observer'], post({ audience: 'staff' })));
  assert.ok(!canRolesSeeOrgPost(['startup_member'], post({ audience: 'staff' })));
  assert.ok(canRolesSeeOrgPost(['startup_member'], post({ audience: 'all' })));
  assert.ok(!canRolesSeeOrgPost(undefined, post({ audience: 'staff' })));
});

test('canEditOrgPost: författare eller admin/incubator_lead — aldrig observer', () => {
  const p = post({ author: 'u1' });
  assert.ok(canEditOrgPost({ id: 'u1', roles: ['coach'] }, p));
  assert.ok(!canEditOrgPost({ id: 'u2', roles: ['coach'] }, p));
  assert.ok(canEditOrgPost({ id: 'u2', roles: ['incubator_lead'] }, p));
  assert.ok(!canEditOrgPost({ id: 'u1', roles: ['observer'] }, p));
  assert.ok(!canEditOrgPost({ id: 'u1', roles: ['startup_member'] }, p));
});

test('sortOrgPosts: fästa först, därefter nyast (publiceringsdatum före skapad)', () => {
  const a = post({ id: 'a', created: '2026-09-01T00:00:00Z' });
  const b = post({ id: 'b', created: '2026-09-05T00:00:00Z' });
  const c = post({ id: 'c', created: '2026-09-02T00:00:00Z', pinned: true });
  const d = post({ id: 'd', created: '2026-08-01T00:00:00Z', published_at: '2026-09-08T00:00:00Z' });
  assert.deepEqual(
    sortOrgPosts([a, b, c, d]).map((p) => p.id),
    ['c', 'd', 'b', 'a']
  );
});

test('selectLiveOrgPosts filtrerar på tid och roll och sorterar', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  const posts = [
    post({ id: 'live-staff' }),
    post({ id: 'live-all', audience: 'all', pinned: true }),
    post({ id: 'future', published_at: '2026-10-01T00:00:00Z' }),
    post({ id: 'expired', expires_at: '2026-09-01T00:00:00Z' })
  ];
  assert.deepEqual(
    selectLiveOrgPosts(posts, ['coach'], now).map((p) => p.id),
    ['live-all', 'live-staff']
  );
  assert.deepEqual(
    selectLiveOrgPosts(posts, ['startup_member'], now).map((p) => p.id),
    ['live-all']
  );
});

test('orgPostExcerpt strippar markdown och kapar med ellips', () => {
  const md = '## Rubrik\n\n- **Fet** punkt\n- [länk](https://x.se) till något\n\n1. ett\n2. två';
  assert.equal(orgPostExcerpt(md), 'Rubrik Fet punkt länk till något ett två');
  const long = 'a'.repeat(400);
  const ex = orgPostExcerpt(long, 50);
  assert.equal(ex.length, 50);
  assert.ok(ex.endsWith('…'));
});

test('training är en egen inläggstyp med egen flik på Hemmaplan', () => {
  const v = validateOrgPostInput({ title: 'GDPR-genomgång', kind: 'training' });
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.value.kind, 'training');
  assert.equal(orgPostTabFor('training'), 'training');
  assert.equal(orgPostTabFor('instruction'), 'instruction');
  assert.equal(orgPostTabFor('news'), 'board');
  assert.equal(orgPostTabFor('celebration'), 'board');
});

test('flik-slugs: URL ↔ flik ↔ inläggstyp hänger ihop', () => {
  assert.equal(orgPostTabFromSlug('internutbildningar'), 'training');
  assert.equal(orgPostTabFromSlug('sa-gor-vi'), 'instruction');
  assert.equal(orgPostTabFromSlug('anslagstavla'), 'board');
  assert.equal(orgPostTabFromSlug(undefined), 'board');
  assert.equal(orgPostTabFromSlug('okänd'), 'board');
  assert.equal(orgPostHomePath('training'), '/hem?flik=internutbildningar');
  assert.equal(orgPostHomePath('instruction'), '/hem?flik=sa-gor-vi');
  assert.equal(orgPostHomePath('news'), '/hem');
});
