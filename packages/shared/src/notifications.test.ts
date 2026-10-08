import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_NOTIFICATION_KINDS,
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_KINDS,
  cleanNotificationText,
  defaultNotificationGroupKey,
  defaultNotificationPreferences,
  effectiveNotificationChannels,
  groupNotificationKindsByCategory,
  groupedNotificationLabel,
  isNotificationKind,
  nextNotificationGroupCount,
  normalizeNotificationPreferences,
  notificationKindsForRoles,
  notificationMeta,
  notificationRetentionCutoffs,
  safeNotificationHref,
  setNotificationKindChannel,
  shouldDeliverInApp,
  toggleMutedNotificationEntity
} from './notifications.ts';

test('katalogen: varje typ har etikett, beskrivning, kategori och standard', () => {
  assert.equal(new Set(NOTIFICATION_KINDS).size, NOTIFICATION_KINDS.length);
  for (const kind of NOTIFICATION_KINDS) {
    const meta = NOTIFICATION_CATALOG[kind];
    assert.ok(meta.label.length > 0, kind);
    assert.ok(meta.description.length > 0, kind);
    assert.ok((NOTIFICATION_CATEGORIES as readonly string[]).includes(meta.category), kind);
    assert.equal(typeof meta.defaults.in_app, 'boolean', kind);
  }
  for (const category of NOTIFICATION_CATEGORIES) {
    assert.ok(NOTIFICATION_CATEGORY_META[category].label.length > 0);
  }
});

test('katalogen: obligatoriska typer är alltid på i appen som standard', () => {
  for (const kind of NOTIFICATION_KINDS) {
    if (NOTIFICATION_CATALOG[kind].mandatory) assert.equal(NOTIFICATION_CATALOG[kind].defaults.in_app, true);
  }
});

test('äldre select-värden finns kvar i katalogen (bakåtkompatibel data)', () => {
  for (const kind of LEGACY_NOTIFICATION_KINDS) assert.ok(isNotificationKind(kind), kind);
});

test('okänd typ ger neutral metadata, aldrig ett kast', () => {
  assert.equal(isNotificationKind('nope'), false);
  assert.equal(notificationMeta('nope').label, 'Notis');
  assert.equal(notificationMeta('mention').label, 'Du blev nämnd');
});

test('typer per roll: bolagsmedlem ser inte personalens typer och tvärtom', () => {
  const member = notificationKindsForRoles(['startup_member']);
  assert.ok(member.includes('workshop_assigned'));
  assert.ok(member.includes('support_check_decision'));
  assert.ok(!member.includes('contact_request'));
  assert.ok(!member.includes('task_assigned'));

  const coach = notificationKindsForRoles(['coach']);
  assert.ok(coach.includes('contact_request'));
  assert.ok(coach.includes('task_assigned'));
  assert.ok(!coach.includes('workshop_assigned'));

  const both = notificationKindsForRoles(['coach', 'startup_member']);
  assert.ok(both.includes('workshop_assigned') && both.includes('contact_request'));
});

test('gruppering per kategori följer kategoriordningen och utelämnar tomma', () => {
  const groups = groupNotificationKindsByCategory(notificationKindsForRoles(['startup_member']));
  assert.ok(groups.every((g) => g.kinds.length > 0));
  assert.ok(!groups.some((g) => g.category === 'kontakter'));
  const order = groups.map((g) => NOTIFICATION_CATEGORIES.indexOf(g.category));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('normalisering: släpper okända typer, kanaler och värden', () => {
  const prefs = normalizeNotificationPreferences({
    kinds: {
      comment: { in_app: false, email: 'instant', push: 'ja', extra: 1 },
      nope: { in_app: false },
      mention: { email: 'weekly' }
    },
    muted: [
      { type: 'missions', id: 'abc123', label: '  Personal   handbok ' },
      { type: 'missions', id: 'abc123' },
      { type: 'Bad Type', id: 'x' },
      { type: 'missions', id: 'a"b' }
    ],
    digest: { frequency: 'weekly', time: '25:00', weekday: 3 }
  });
  assert.deepEqual(prefs.kinds, { comment: { in_app: false, email: 'instant' } });
  assert.deepEqual(prefs.muted, [{ type: 'missions', id: 'abc123', label: 'Personal handbok' }]);
  assert.deepEqual(prefs.digest, { frequency: 'weekly', time: '07:30', weekday: 3 });
});

test('normalisering: skräp ger standardinställningar', () => {
  for (const raw of [null, undefined, 'x', 42, [], { kinds: [] }]) {
    assert.deepEqual(normalizeNotificationPreferences(raw), defaultNotificationPreferences());
  }
});

test('effektiva kanaler: eget val ovanpå standard, obligatoriskt alltid på i appen', () => {
  const prefs = normalizeNotificationPreferences({
    kinds: { comment: { in_app: false }, agreement_to_sign: { in_app: false, email: 'off' } }
  });
  assert.equal(effectiveNotificationChannels(prefs, 'comment').in_app, false);
  assert.equal(effectiveNotificationChannels(prefs, 'mention').in_app, true);
  const agreement = effectiveNotificationChannels(prefs, 'agreement_to_sign');
  assert.equal(agreement.in_app, true);
  assert.equal(agreement.email, 'off');
});

test('leverans: avstängd typ och tystad sak stoppas, obligatoriskt går alltid fram', () => {
  let prefs = defaultNotificationPreferences();
  const mission = { type: 'missions', id: 'm1' };
  assert.equal(shouldDeliverInApp(prefs, 'comment', mission), true);

  prefs = setNotificationKindChannel(prefs, 'comment', 'in_app', false);
  assert.equal(shouldDeliverInApp(prefs, 'comment', mission), false);
  assert.equal(shouldDeliverInApp(prefs, 'mention', mission), true);

  prefs = toggleMutedNotificationEntity(prefs, { ...mission, label: 'Uppdrag' }, true);
  assert.equal(shouldDeliverInApp(prefs, 'mention', mission), false);
  assert.equal(shouldDeliverInApp(prefs, 'mention', { type: 'missions', id: 'm2' }), true);
  assert.equal(shouldDeliverInApp(prefs, 'agreement_to_sign', mission), true);

  prefs = toggleMutedNotificationEntity(prefs, mission, false);
  assert.equal(shouldDeliverInApp(prefs, 'mention', mission), true);
});

test('setNotificationKindChannel: tar bort överstyrning som sammanfaller med standard', () => {
  let prefs = setNotificationKindChannel(defaultNotificationPreferences(), 'comment', 'in_app', false);
  assert.deepEqual(prefs.kinds.comment, { in_app: false });
  prefs = setNotificationKindChannel(prefs, 'comment', 'in_app', true);
  assert.equal(prefs.kinds.comment, undefined);

  prefs = setNotificationKindChannel(prefs, 'comment', 'email', 'off');
  assert.deepEqual(prefs.kinds.comment, { email: 'off' });
  // Ogiltigt värde ignoreras.
  assert.equal(setNotificationKindChannel(prefs, 'comment', 'email', 'weekly' as never), prefs);
  // Obligatorisk typ kan inte stängas av i appen.
  const locked = setNotificationKindChannel(prefs, 'contact_request', 'in_app', false);
  assert.equal(locked.kinds.contact_request, undefined);
});

test('text: plattas, personnummer tvättas och kapas', () => {
  assert.equal(cleanNotificationText('  hej\n\n då ', 50), 'hej då');
  assert.equal(cleanNotificationText('pnr 19900101-1234 här', 50), 'pnr [REDACTED] här');
  const long = cleanNotificationText('a'.repeat(300), 10);
  assert.equal(long.length, 10);
  assert.ok(long.endsWith('…'));
  assert.equal(cleanNotificationText(42, 10), '');
});

test('länkar: bara relativa sökvägar inom appen', () => {
  assert.equal(safeNotificationHref('/uppdrag/abc?x=1#y'), '/uppdrag/abc?x=1#y');
  for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil', '/a\tb', '', 7]) {
    assert.equal(safeNotificationHref(bad), '/inkorg', String(bad));
  }
  assert.equal(safeNotificationHref('nope', '/hem'), '/hem');
});

test('gruppering: räknaren ökar och kapas', () => {
  assert.equal(nextNotificationGroupCount(undefined), 2);
  assert.equal(nextNotificationGroupCount(4), 5);
  assert.equal(nextNotificationGroupCount(999), 999);
  assert.equal(groupedNotificationLabel('comment', 1), 'Ny kommentar');
  assert.equal(groupedNotificationLabel('comment', 3), 'Ny kommentar (3)');
});

test('lagringsminimering: 90 dagar för lästa, 180 för olästa', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const { read, unread } = notificationRetentionCutoffs(now);
  assert.equal(read, '2026-07-10T12:00:00.000Z');
  assert.equal(unread, '2026-04-11T12:00:00.000Z');
});

test('gruppnyckel: bara sammanslagningsbara typer med giltig sak', () => {
  assert.equal(defaultNotificationGroupKey('comment', { type: 'missions', id: 'm1' }), 'comment:missions:m1');
  assert.equal(defaultNotificationGroupKey('mention', { type: 'missions', id: 'm1' }), null);
  assert.equal(defaultNotificationGroupKey('comment', null), null);
  assert.equal(defaultNotificationGroupKey('comment', { type: 'missions', id: 'a b' }), null);
});
