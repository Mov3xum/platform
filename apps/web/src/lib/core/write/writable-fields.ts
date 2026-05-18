import 'server-only';
import type { Role } from '@platform/shared';
import type { Actor } from './types';

/**
 * Fält-whitelist per (collection, field) med separata policies för
 * mänskliga aktörer och agenter. **Agent-whitelisten är alltid en
 * delmängd av människo-whitelisten** — en agent får aldrig göra mer
 * än någon roll får göra. Detta är källan av sanning; alla
 * skrivningar (UI + agent) går genom `canWriteField` som konsulterar
 * denna tabell.
 *
 * Att lägga till nya skrivbara fält:
 *   1. Lägg till entry här
 *   2. Lägg till validator i `validators.ts` om värdet behöver formgranskas
 *   3. Lägg till mappning i kärnfunktionen för aktuell collection
 */

type UserPolicy =
  | { kind: 'any-role' }
  | { kind: 'roles'; roles: Role[] };

type AgentPolicy = { kind: 'allow' } | { kind: 'deny'; reason: string };

interface FieldPolicy {
  user: UserPolicy;
  agent: AgentPolicy;
}

const STAFF_AND_COACH: Role[] = ['admin', 'incubator_lead', 'coach'];

const POLICIES: Record<string, Record<string, FieldPolicy>> = {
  startups: {
    next_step: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'allow' }
    },
    irl_level: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'allow' }
    },
    // Phase och status får agenten INTE skriva i denna fas — det kräver
    // state-machine-validering (roadmap-steg 2). Människor får, men
    // även deras skrivningar loggas i agent_actions.
    phase: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Kräver state-machine — kommer i nästa fas.' }
    },
    status: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Kräver state-machine — kommer i nästa fas.' }
    },
    name: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Bolagsnamn ändras inte av agent.' }
    },
    description: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Beskrivning ändras inte av agent i MVP.' }
    },
    tags: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Taggar ändras inte av agent i MVP.' }
    }
  },
  activities: {
    title: {
      user: { kind: 'any-role' },
      agent: { kind: 'allow' }
    },
    description: {
      user: { kind: 'any-role' },
      agent: { kind: 'allow' }
    },
    status: {
      user: { kind: 'any-role' },
      agent: { kind: 'allow' }
    }
  }
};

/** Vilka collections som har create-stöd via det delade lagret. */
const CREATE_POLICIES: Record<
  string,
  { user: UserPolicy; agent: AgentPolicy }
> = {
  activities: {
    user: { kind: 'any-role' },
    agent: { kind: 'allow' }
  }
};

function matchUserPolicy(roles: Role[], policy: UserPolicy): boolean {
  if (policy.kind === 'any-role') return roles.length > 0;
  return roles.some((r) => policy.roles.includes(r));
}

export interface PolicyResult {
  ok: boolean;
  reason?: string;
}

export function canWriteField(
  actor: Actor,
  collection: string,
  field: string
): PolicyResult {
  const collectionPolicy = POLICIES[collection];
  if (!collectionPolicy) {
    return { ok: false, reason: `Kollektion '${collection}' är inte skrivbar via det delade lagret.` };
  }
  const fieldPolicy = collectionPolicy[field];
  if (!fieldPolicy) {
    return { ok: false, reason: `Fältet '${collection}.${field}' är inte whitelistat för skrivning.` };
  }

  if (actor.kind === 'agent') {
    if (fieldPolicy.agent.kind === 'deny') {
      return { ok: false, reason: fieldPolicy.agent.reason };
    }
    return { ok: true };
  }

  // user
  if (!matchUserPolicy(actor.roles, fieldPolicy.user)) {
    return { ok: false, reason: `Saknar roll för att skriva '${collection}.${field}'.` };
  }
  return { ok: true };
}

export function canCreateRecord(actor: Actor, collection: string): PolicyResult {
  const policy = CREATE_POLICIES[collection];
  if (!policy) {
    return { ok: false, reason: `Kollektion '${collection}' stöder inte create via det delade lagret.` };
  }
  if (actor.kind === 'agent') {
    if (policy.agent.kind === 'deny') {
      return { ok: false, reason: policy.agent.reason };
    }
    return { ok: true };
  }
  if (!matchUserPolicy(actor.roles, policy.user)) {
    return { ok: false, reason: `Saknar roll för att skapa i '${collection}'.` };
  }
  return { ok: true };
}

/** Lista över fält som agenten får skriva i en collection — används för
 * att generera tool-schemat för LLM:en. */
export function agentWritableFields(collection: string): string[] {
  const collectionPolicy = POLICIES[collection];
  if (!collectionPolicy) return [];
  return Object.entries(collectionPolicy)
    .filter(([, p]) => p.agent.kind === 'allow')
    .map(([f]) => f);
}

/** Lista över collections agenten får skapa rader i. */
export function agentCreatableCollections(): string[] {
  return Object.entries(CREATE_POLICIES)
    .filter(([, p]) => p.agent.kind === 'allow')
    .map(([c]) => c);
}
