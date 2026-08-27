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
// Årshjulet är intern verksamhetsplanering — hela Movexum-staben redigerar.
const STAFF_FULL: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
// Startupkompassen hanteras av admin/incubator_lead/coach (samma krets som
// `MANAGE_ROLES` i lib/actions/compass.ts, § 23).
const COMPASS_MANAGE: Role[] = ['admin', 'incubator_lead', 'coach'];

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
  },
  // Årshjul (§ 30). Hela aktiviteten är icke-PII verksamhetsplanering, så
  // agenten får uppdatera alla fält (människa-i-loopen i staff-chatten).
  annual_wheel_items: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    month: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    day: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    tags: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    category: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    // Ansvarig pekar ut en intern användare. Agenten kan inte slå upp
    // användar-id:n (`users` är denylistad, § 9.3) och ska inte gissa vem som
    // äger en aktivitet → människan sätter ansvarig i UI:t.
    responsible: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Ansvarig sätts av en människa i årshjulet.' }
    },
    notes: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    year: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } }
  },
  // Startupkompassens intag-moduler (§ 23, § 31). Ren modulkonfiguration —
  // ingen besökardata, ingen PII. Publiceringsfälten (`is_active`,
  // `public_url_enabled`) är MEDVETET agent-nekade: att lägga ut en modul
  // publikt på webben är ett mänskligt beslut i modul-admin.
  compass_modules: {
    name: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    intro_message: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    success_message: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    target_audience: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    consent_note: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    flow_type: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    is_active: {
      user: { kind: 'roles', roles: COMPASS_MANAGE },
      agent: { kind: 'deny', reason: 'Publicering av en modul görs av en människa i modul-admin.' }
    },
    public_url_enabled: {
      user: { kind: 'roles', roles: COMPASS_MANAGE },
      agent: { kind: 'deny', reason: 'Publik URL slås på av en människa i modul-admin.' }
    }
  },
  // Frågor i en intag-modul. `key` och `input_type` sätts vid skapandet och
  // ändras inte i efterhand — svar som redan samlats in refererar dem.
  compass_questions: {
    prompt: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    help_text: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    required: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } }
  },
  // Workshops (§ 18). Agenten får förbereda innehåll i ett UTKAST; att
  // publicera och tilldela bolag är mänskliga beslut.
  workshops: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    goal: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    instructions: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    status: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Publicering av en workshop görs av en människa i /education.' }
    },
    active: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Aktivering av en workshop görs av en människa i /education.' }
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
  },
  annual_wheel_items: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  compass_modules: {
    user: { kind: 'roles', roles: COMPASS_MANAGE },
    agent: { kind: 'allow' }
  },
  compass_questions: {
    user: { kind: 'roles', roles: COMPASS_MANAGE },
    agent: { kind: 'allow' }
  },
  workshops: {
    user: { kind: 'roles', roles: STAFF_FULL },
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

  if (actor.kind === 'agent' && fieldPolicy.agent.kind === 'deny') {
    return { ok: false, reason: fieldPolicy.agent.reason };
  }

  // Rollkravet gäller BÅDA aktörstyperna: en agent kör alltid å en inloggad
  // människas vägnar (`actor.roles` = den triggande användarens roller), så
  // agent-whitelisten förblir en äkta delmängd av människo-whitelisten — en
  // mentor kan inte via chatten göra det hen inte får göra i UI:t
  // (ISO 27001 A.5.15–A.5.18 minsta behörighet).
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
  if (actor.kind === 'agent' && policy.agent.kind === 'deny') {
    return { ok: false, reason: policy.agent.reason };
  }
  // Se `canWriteField`: rollkravet gäller även agent-aktörer.
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
