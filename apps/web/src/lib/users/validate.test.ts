import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ROLES } from '@platform/shared';
import { assignableRolesFor, validateNewUserInput } from './validate';

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
