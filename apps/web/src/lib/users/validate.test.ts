import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ROLES } from '@platform/shared';
import {
  assignableRolesFor,
  canManageUser,
  validateDeleteConfirmation,
  validateNewPassword,
  validateNewUserInput,
  validateRolesUpdate
} from './validate';

const allRoles = { assignableRoles: [...ALL_ROLES] };

const validMember = {
  email: 'Anna@Bolag.SE',
  displayName: '  Anna Andersson  ',
  password: 'hunter2hunter',
  role: 'startup_member',
  startupId: 'abc123'
};

const validStaff = {
  email: 'coach@movexum.se',
  displayName: 'Carl Coach',
  password: 'hunter2hunter',
  role: 'coach',
  startupId: ''
};

test('accepterar giltig bolagsmedlem och normaliserar e-post + namn', () => {
  const res = validateNewUserInput(validMember, allRoles);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.email, 'anna@bolag.se');
    assert.equal(res.value.displayName, 'Anna Andersson');
    assert.equal(res.value.role, 'startup_member');
    assert.equal(res.value.startupId, 'abc123');
  }
});

test('accepterar staff-roll utan bolag och nollställer startupId', () => {
  const res = validateNewUserInput({ ...validStaff, startupId: 'råkar-finnas' }, allRoles);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.role, 'coach');
    assert.equal(res.value.startupId, '');
  }
});

test('kräver e-post, namn, lösenord och roll', () => {
  for (const missing of ['email', 'displayName', 'password', 'role'] as const) {
    const res = validateNewUserInput({ ...validMember, [missing]: '' }, allRoles);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /obligatoriska/);
  }
});

test('kräver bolag för bolagsmedlem', () => {
  const res = validateNewUserInput({ ...validMember, startupId: '' }, allRoles);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /bolag/i);
});

test('avvisar ogiltig e-post', () => {
  const res = validateNewUserInput({ ...validMember, email: 'inte-en-epost' }, allRoles);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /e-post/i);
});

test('kräver minst 8 teckens lösenord', () => {
  const res = validateNewUserInput({ ...validMember, password: 'kort' }, allRoles);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /8 tecken/);
});

test('avvisar för långt namn', () => {
  const res = validateNewUserInput({ ...validMember, displayName: 'a'.repeat(201) }, allRoles);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /för långt/);
});

test('avvisar okänd roll', () => {
  const res = validateNewUserInput({ ...validStaff, role: 'superadmin' }, allRoles);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /roll/i);
});

test('avvisar roll som skaparen inte får tilldela', () => {
  const res = validateNewUserInput(
    { ...validStaff, role: 'admin' },
    { assignableRoles: assignableRolesFor(['incubator_lead']) }
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /behörighet/i);
});

test('hanterar saknade/icke-sträng-värden utan att krascha', () => {
  const res = validateNewUserInput({}, allRoles);
  assert.equal(res.ok, false);
});

test('assignableRolesFor: admin får alla roller', () => {
  const roles = assignableRolesFor(['admin']);
  assert.deepEqual(roles, [...ALL_ROLES]);
});

test('assignableRolesFor: incubator_lead får alla utom admin', () => {
  const roles = assignableRolesFor(['incubator_lead']);
  assert.ok(!roles.includes('admin'));
  assert.ok(roles.includes('startup_member'));
  assert.ok(roles.includes('incubator_lead'));
});

// ── Administration av befintliga användare ───────────────────────────────

test('canManageUser: admin får hantera alla, incubator_lead inte admin-konton', () => {
  assert.equal(canManageUser(['admin'], ['admin']), true);
  assert.equal(canManageUser(['incubator_lead'], ['coach']), true);
  assert.equal(canManageUser(['incubator_lead'], ['admin', 'coach']), false);
  assert.equal(canManageUser(['incubator_lead'], undefined), true);
});

test('validateRolesUpdate: accepterar JSON-sträng, dedupar och normaliserar', () => {
  const res = validateRolesUpdate('["coach","coach"," mentor "]', {
    assignableRoles: [...ALL_ROLES],
    isSelf: false
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.value, ['coach', 'mentor']);
});

test('validateRolesUpdate: kräver minst en roll och giltiga roller', () => {
  assert.equal(validateRolesUpdate([], { assignableRoles: [...ALL_ROLES], isSelf: false }).ok, false);
  assert.equal(
    validateRolesUpdate(['superuser'], { assignableRoles: [...ALL_ROLES], isSelf: false }).ok,
    false
  );
  assert.equal(validateRolesUpdate('not json', { assignableRoles: [...ALL_ROLES], isSelf: false }).ok, false);
});

test('validateRolesUpdate: incubator_lead kan inte tilldela admin', () => {
  const res = validateRolesUpdate(['admin'], {
    assignableRoles: assignableRolesFor(['incubator_lead']),
    isSelf: false
  });
  assert.equal(res.ok, false);
});

test('validateRolesUpdate: egna administrationsroller kan inte tas bort', () => {
  const res = validateRolesUpdate(['coach'], { assignableRoles: [...ALL_ROLES], isSelf: true });
  assert.equal(res.ok, false);
  const ok = validateRolesUpdate(['incubator_lead', 'coach'], {
    assignableRoles: [...ALL_ROLES],
    isSelf: true
  });
  assert.equal(ok.ok, true);
});

test('validateNewPassword: 8–72 tecken', () => {
  assert.equal(validateNewPassword('kort').ok, false);
  assert.equal(validateNewPassword('a'.repeat(73)).ok, false);
  assert.equal(validateNewPassword('hunter2hunter').ok, true);
});

test('validateDeleteConfirmation: kräver exakt e-post (skiftlägesokänsligt)', () => {
  assert.equal(validateDeleteConfirmation('Anna@Bolag.se ', 'anna@bolag.se').ok, true);
  assert.equal(validateDeleteConfirmation('anna@bolag.se', 'bert@bolag.se').ok, false);
  assert.equal(validateDeleteConfirmation('', 'anna@bolag.se').ok, false);
});

// ── Modulåtkomst per användare (§ 36.3) ─────────────────────────────────────
import { enabledModulesAfterRoleChange, toggleableModulesForRoles, validateEnabledModules } from './validate';
import { ALWAYS_ON_MODULE_IDS, MEMBER_RAIL, defaultModulesForRoles } from '@platform/shared';

test('toggleableModulesForRoles: bara rollens moduler, aldrig alltid-på/legacy', () => {
  const coach = toggleableModulesForRoles(['coach']).map((m) => m.id);
  assert.ok(coach.includes('startups'));
  assert.ok(coach.includes('inflode'));
  assert.ok(!coach.includes('rapporter'), 'rapporter är admin/incubator_lead-only');
  for (const id of ALWAYS_ON_MODULE_IDS) assert.ok(!coach.includes(id), `${id} ska inte kunna togglas`);
  assert.ok(!coach.includes('toolbox'), 'legacy-alias visas inte');
  assert.deepEqual(toggleableModulesForRoles(undefined), []);
});

test('validateEnabledModules: saknat värde ⇒ rollens standard, annars sanerad lista', () => {
  const dflt = validateEnabledModules(undefined, ['mentor']);
  assert.ok(dflt.ok);
  assert.deepEqual(dflt.value, defaultModulesForRoles(['mentor']));

  const explicit = validateEnabledModules(JSON.stringify(['startups', 'rapporter', 'installningar']), ['coach']);
  assert.ok(explicit.ok);
  assert.deepEqual(explicit.value, ['startups'], 'rapporter (utanför rollen) och installningar (alltid-på) filtreras');

  const empty = validateEnabledModules('[]', ['coach']);
  assert.ok(empty.ok);
  assert.deepEqual(empty.value, []);

  assert.equal(validateEnabledModules('nope', ['coach']).ok, false);
});

test('toggleableModulesForRoles: ren bolagsmedlem får bara medlems-railen, multi-roll hela listan', () => {
  const member = toggleableModulesForRoles(['startup_member']).map((m) => m.id);
  assert.deepEqual(new Set(member), new Set(MEMBER_RAIL.map((m) => m.id)));
  assert.ok(!member.includes('idag'), 'chatten är en no-op för en ren medlem');
  const multi = toggleableModulesForRoles(['coach', 'startup_member']).map((m) => m.id);
  assert.ok(multi.includes('idag'));
  assert.ok(multi.includes('min_oversikt'));
});

test('enabledModulesAfterRoleChange: behåller val, lägger till nya rollens standard, släpper otillåtna', () => {
  assert.equal(enabledModulesAfterRoleChange(null, ['admin']), null, 'aldrig justerad lämnas orörd');
  const promoted = enabledModulesAfterRoleChange(['idag', 'startups'], ['incubator_lead'])!;
  assert.ok(promoted.includes('idag'));
  assert.ok(promoted.includes('rapporter'), 'ny rolls standard unioneras in');
  const demoted = enabledModulesAfterRoleChange(['idag', 'rapporter', 'startups'], ['observer'])!;
  assert.ok(!demoted.includes('rapporter'), 'moduler den nya rollen inte tillåter släpps');
  assert.ok(demoted.includes('startups'));
});
