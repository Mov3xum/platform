import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_DAYS_WINDOW,
  DORMANT_AFTER_DAYS,
  MODULE_STAT_RETENTION_DAYS,
  activeDaysWithin,
  activityStatus,
  applyLogin,
  applyVisit,
  emptyUserActivity,
  formatRelativeTime,
  isValidModuleId,
  moduleIdForPath,
  neverOpenedModules,
  normalizeUserActivity,
  topModules
} from './user-activity';

const MODULES = [
  { id: 'hem', route: '/hem' },
  { id: 'idag', route: '/chatt' },
  { id: 'startups', route: '/startups' },
  { id: 'inflode', route: '/inflode' },
  { id: 'events', route: '/inflode/events' },
  { id: 'installningar', route: '/installningar' },
  { id: 'anvandare', route: '/installningar/anvandare' },
  { id: 'insights', route: '/installningar/ai-analys' },
  { id: 'agenter', route: '/toolbox' },
  { id: 'toolbox', route: '/toolbox' },
  { id: 'dashboard', route: '/chatt' }
];

const NOW = new Date('2026-11-04T10:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

test('moduleIdForPath: längsta route vinner och alias slås ihop', () => {
  assert.equal(moduleIdForPath('/installningar/anvandare', MODULES), 'anvandare');
  assert.equal(moduleIdForPath('/installningar/anvandare?x=1', MODULES), 'anvandare');
  assert.equal(moduleIdForPath('/installningar', MODULES), 'installningar');
  assert.equal(moduleIdForPath('/installningar/utseende', MODULES), 'installningar');
  assert.equal(moduleIdForPath('/inflode/events/abc', MODULES), 'events');
  assert.equal(moduleIdForPath('/inflode/leads', MODULES), 'inflode');
  assert.equal(moduleIdForPath('/startups/abc/ekonomi#de-minimis', MODULES), 'startups');
  // Alias-id:n (toolbox/dashboard) registreras alltid som sitt mål.
  assert.equal(moduleIdForPath('/toolbox/xyz', MODULES), 'agenter');
  assert.equal(moduleIdForPath('/chatt', MODULES), 'idag');
  // Prefix utan snedstreck matchar inte ("/startupsx").
  assert.equal(moduleIdForPath('/startupsx', MODULES), null);
  assert.equal(moduleIdForPath('/konto', MODULES), null);
  assert.equal(moduleIdForPath('/login', MODULES), null);
  assert.equal(moduleIdForPath('konto', MODULES), null);
});

test('isValidModuleId avvisar allt som inte är ett modul-id', () => {
  assert.equal(isValidModuleId('hem'), true);
  assert.equal(isValidModuleId('bedomning_excellens'), true);
  assert.equal(isValidModuleId('Hem'), false);
  assert.equal(isValidModuleId('/hem'), false);
  assert.equal(isValidModuleId(''), false);
  assert.equal(isValidModuleId('a'.repeat(41)), false);
  assert.equal(isValidModuleId(42), false);
});

test('applyLogin räknar inloggningar och sätter första/senaste', () => {
  const a = applyLogin(emptyUserActivity(), daysAgo(10));
  assert.equal(a.login_count, 1);
  assert.equal(a.first_login_at, daysAgo(10).toISOString());
  assert.equal(a.last_login_at, daysAgo(10).toISOString());
  assert.equal(a.last_seen_at, daysAgo(10).toISOString());
  const b = applyLogin(a, NOW);
  assert.equal(b.login_count, 2);
  assert.equal(b.first_login_at, daysAgo(10).toISOString(), 'första inloggningen behålls');
  assert.equal(b.last_login_at, NOW.toISOString());
  assert.deepEqual(b.active_days, ['2026-10-25', '2026-11-04']);
  // Muterar inte.
  assert.equal(a.login_count, 1);
});

test('applyVisit räknar besök per modul och sätter senast aktiv', () => {
  let s = applyVisit(emptyUserActivity(), 'hem', daysAgo(2));
  s = applyVisit(s, 'hem', daysAgo(1));
  s = applyVisit(s, 'startups', NOW);
  assert.equal(s.modules.hem.visits, 2);
  assert.equal(s.modules.hem.first_at, daysAgo(2).toISOString());
  assert.equal(s.modules.hem.last_at, daysAgo(1).toISOString());
  assert.equal(s.modules.startups.visits, 1);
  assert.equal(s.last_module, 'startups');
  assert.equal(s.last_seen_at, NOW.toISOString());
  assert.equal(s.active_days.length, 3);
  assert.equal(s.login_count, 0, 'ett besök är ingen inloggning');
});

test('aktiva dagar hålls i ett rullande fönster och gamla modulrader rensas', () => {
  let s = emptyUserActivity();
  s = applyVisit(s, 'gammal', daysAgo(MODULE_STAT_RETENTION_DAYS + 5));
  s = applyVisit(s, 'hem', daysAgo(ACTIVE_DAYS_WINDOW + 3));
  assert.ok('gammal' in s.modules, 'rensas först vid NÄSTA skrivning');
  s = applyVisit(s, 'hem', NOW);
  assert.ok(!('gammal' in s.modules), 'raden äldre än lagringstiden är borta');
  assert.deepEqual(s.active_days, ['2026-11-04'], 'dagen utanför fönstret är borta');
});

test('activityStatus: aldrig / aktiv / vilande', () => {
  assert.equal(activityStatus(emptyUserActivity(), NOW), 'never');
  assert.equal(activityStatus(applyLogin(emptyUserActivity(), daysAgo(3)), NOW), 'active');
  assert.equal(activityStatus(applyLogin(emptyUserActivity(), daysAgo(DORMANT_AFTER_DAYS)), NOW), 'active');
  assert.equal(activityStatus(applyLogin(emptyUserActivity(), daysAgo(DORMANT_AFTER_DAYS + 1)), NOW), 'dormant');
  // Senast sedd väger tyngre än senaste inloggning (sessionen lever 14 dagar).
  const s = applyVisit(applyLogin(emptyUserActivity(), daysAgo(40)), 'hem', daysAgo(2));
  assert.equal(activityStatus(s, NOW), 'active');
});

test('activeDaysWithin räknar bara fönstret', () => {
  let s = emptyUserActivity();
  for (const d of [0, 1, 5, 29, 30, 45]) s = applyVisit(s, 'hem', daysAgo(d));
  assert.equal(activeDaysWithin(s, NOW, 30), 4);
  assert.equal(activeDaysWithin(s, NOW, 7), 3);
});

test('topModules sorterar på besök och neverOpenedModules listar det som aldrig öppnats', () => {
  let s = emptyUserActivity();
  s = applyVisit(s, 'hem', daysAgo(1));
  s = applyVisit(s, 'hem', NOW);
  s = applyVisit(s, 'mal', daysAgo(3));
  assert.deepEqual(
    topModules(s).map((m) => m.id),
    ['hem', 'mal']
  );
  assert.deepEqual(neverOpenedModules(['hem', 'mal', 'arshjul', 'filer'], s), ['arshjul', 'filer']);
});

test('normalizeUserActivity är tolerant mot trasig data', () => {
  assert.deepEqual(normalizeUserActivity(null), emptyUserActivity());
  assert.deepEqual(normalizeUserActivity('x'), emptyUserActivity());
  const n = normalizeUserActivity({
    first_login_at: 'inte ett datum',
    last_login_at: '2026-11-01T08:00:00.000Z',
    login_count: '3',
    last_module: '/hem',
    modules: {
      hem: { visits: 0, last_at: '2026-11-01T08:00:00.000Z' },
      'Bad Id': { visits: 2, last_at: '2026-11-01T08:00:00.000Z' },
      utan_datum: { visits: 2 }
    },
    active_days: ['2026-11-01', 'igår', '2026-11-01', 7]
  });
  assert.equal(n.first_login_at, null);
  assert.equal(n.last_login_at, '2026-11-01T08:00:00.000Z');
  assert.equal(n.login_count, 3);
  assert.equal(n.last_module, null);
  assert.deepEqual(Object.keys(n.modules), ['hem']);
  assert.equal(n.modules.hem.visits, 1, 'visits golvas till 1');
  assert.equal(n.modules.hem.first_at, n.modules.hem.last_at);
  assert.deepEqual(n.active_days, ['2026-11-01']);
});

test('formatRelativeTime på svenska', () => {
  assert.equal(formatRelativeTime(null, NOW), 'aldrig');
  assert.equal(formatRelativeTime(NOW.toISOString(), NOW), 'just nu');
  assert.equal(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW), 'för 5 min sedan');
  assert.equal(formatRelativeTime(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW), 'för 3 h sedan');
  assert.equal(formatRelativeTime(daysAgo(1).toISOString(), NOW), 'igår');
  assert.equal(formatRelativeTime(daysAgo(4).toISOString(), NOW), 'för 4 dagar sedan');
  assert.equal(formatRelativeTime(daysAgo(21).toISOString(), NOW), 'för 3 veckor sedan');
  assert.equal(formatRelativeTime(daysAgo(70).toISOString(), NOW), 'för 2 månader sedan');
  assert.equal(formatRelativeTime(daysAgo(400).toISOString(), NOW), '2025-09-30');
});
