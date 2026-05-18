import 'server-only';
import type { Role } from '@platform/shared';

/**
 * Det delade skrivlagret. Allt som ändrar data i plattformen ska gå
 * härigenom — UI:s server actions via `actor.kind = 'user'` och
 * AI-agentens verktyg via `actor.kind = 'agent'`. Då håller vi RBAC,
 * fält-whitelist, validering och audit på ett ställe (symmetri
 * människa ↔ agent, se /root/.claude/plans/vi-g-r-mot-att-logical-bunny.md).
 */
export type ActorKind = 'user' | 'agent';

export interface Actor {
  kind: ActorKind;
  /** PocketBase user-id. För `kind: 'agent'` är detta den triggande användaren. */
  id: string;
  tenant: string;
  roles: Role[];
  /** Tool-rad som agenten kör som. Bara när `kind === 'agent'`. */
  agentId?: string;
  /** Tool_runs-rad som agent-skrivningen tillhör. Bara när `kind === 'agent'`. */
  toolRunId?: string;
}

export type WriteResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: WriteErrorCode };

export type WriteErrorCode =
  | 'FORBIDDEN'
  | 'FIELD_NOT_WRITABLE'
  | 'INVALID_VALUE'
  | 'NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'STATE_TRANSITION'
  | 'DB_ERROR';

export function fail<T>(code: WriteErrorCode, error: string): WriteResult<T> {
  return { ok: false, code, error };
}

export function ok<T>(value: T): WriteResult<T> {
  return { ok: true, value };
}
