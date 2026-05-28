import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRole,
  requireRole,
  canRunTool,
  canActivateConnector
} from './rbac';
import type { Role } from '@platform/shared';

// Låser de RBAC-invarianter som CLAUDE.md § 9.5 / § 13.4 bygger på.
// `observer` är read-only och får ALDRIG köra/aktivera något.

const tool = (over: Partial<{ active: boolean; roles_allowed: Role[]; requires_startup: boolean }> = {}) => ({
  active: over.active ?? true,
  roles_allowed: over.roles_allowed ?? (['coach'] as Role[]),
  requires_startup: over.requires_startup ?? false
});

test('hasRole kräver en överlappande roll', () => {
  assert.equal(hasRole(['coach'], ['coach', 'mentor']), true);
  assert.equal(hasRole(['observer'], ['coach', 'mentor']), false);
  assert.equal(hasRole(undefined, ['admin']), false);
  assert.equal(hasRole([], ['admin']), false);
});

test('requireRole kastar vid saknad roll', () => {
  assert.throws(() => requireRole(['observer'], ['admin']), /Forbidden/);
  assert.doesNotThrow(() => requireRole(['admin'], ['admin']));
});

test('canRunTool: inaktivt verktyg går aldrig att köra', () => {
  assert.equal(canRunTool(['admin'], tool({ active: false })), false);
});

test('canRunTool: staff får alltid köra aktiva verktyg', () => {
  assert.equal(canRunTool(['admin'], tool({ roles_allowed: [] })), true);
  assert.equal(canRunTool(['incubator_lead'], tool({ roles_allowed: [] })), true);
});

test('canRunTool: icke-staff kräver en roll i roles_allowed', () => {
  assert.equal(canRunTool(['coach'], tool({ roles_allowed: ['coach'] })), true);
  assert.equal(canRunTool(['mentor'], tool({ roles_allowed: ['coach'] })), false);
});

test('canRunTool: startup_member + requires_startup kräver länkat bolag', () => {
  const t = tool({ roles_allowed: ['startup_member'], requires_startup: true });
  assert.equal(canRunTool(['startup_member'], t, { isLinkedStartup: true }), true);
  assert.equal(canRunTool(['startup_member'], t, { isLinkedStartup: false }), false);
  assert.equal(canRunTool(['startup_member'], t), false);
});

test('canRunTool: enbart-observer kör aldrig (§ 9.5, hård spärr)', () => {
  assert.equal(canRunTool(['observer'], tool({ roles_allowed: ['coach'] })), false);
  // Hård spärr: nekas ÄVEN om ett verktyg av misstag listar observer.
  assert.equal(canRunTool(['observer'], tool({ roles_allowed: ['observer'] })), false);
  assert.equal(canRunTool(undefined, tool()), false);
});

test('canRunTool: multi-roll (coach+observer) kör på sin andra roll', () => {
  assert.equal(canRunTool(['observer', 'coach'], tool({ roles_allowed: ['coach'] })), true);
  // Staff + observer påverkas inte av observer-spärren.
  assert.equal(canRunTool(['observer', 'admin'], tool({ roles_allowed: [] })), true);
});

test('canActivateConnector: enbart-observer är spärrad', () => {
  assert.equal(canActivateConnector(['observer'], { kind: 'builtin', id: 'web_search' }, null), false);
  assert.equal(canActivateConnector([], { kind: 'mcp', id: 'x' }, null), false);
});

test('canActivateConnector: MCP tillåts för icke-observer (workspace styr hos Mistral)', () => {
  assert.equal(canActivateConnector(['coach'], { kind: 'mcp', id: 'whatever' }, null), true);
});

test('canActivateConnector: staff får alla built-ins utan allowlist', () => {
  assert.equal(canActivateConnector(['admin'], { kind: 'builtin', id: 'code_interpreter' }, null), true);
});

test('canActivateConnector: icke-staff begränsas av tenant-allowlist', () => {
  assert.equal(
    canActivateConnector(['coach'], { kind: 'builtin', id: 'code_interpreter' }, ['web_search']),
    false
  );
  assert.equal(
    canActivateConnector(['coach'], { kind: 'builtin', id: 'image_generation' }, ['image_generation']),
    true
  );
});

test('canActivateConnector: utan allowlist är bara web_search default-tillåten', () => {
  assert.equal(canActivateConnector(['coach'], { kind: 'builtin', id: 'web_search' }, null), true);
  assert.equal(canActivateConnector(['coach'], { kind: 'builtin', id: 'code_interpreter' }, null), false);
});
