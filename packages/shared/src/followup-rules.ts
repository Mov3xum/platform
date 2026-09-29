/**
 * Generisk uppföljningsmotor — ren, IO-fri (CLAUDE.md § 40).
 *
 * En "uppföljningsregel" säger: *`offset_days` från ett ANKARE ska uppgiften
 * `task_title` finnas (`repeat` gånger), så länge ett VILLKOR gäller.* Motorn
 * expanderar regler mot mål (upphandlingar/avrop, programdeltaganden,
 * partneravtal, finansieringsprojekt …) till konkreta, DETERMINISTISKA
 * uppgifter med stabil idempotensnyckel (`tasks.rule_key`), och diffar planen
 * mot befintliga kort så synken (IO, `lib/followups/sync.ts`) blir ett tunt
 * skal: skapa saknade, flytta ändrade, auto-stäng upphörda.
 *
 * Det domänspecifika — vilka mål en regel gäller, vad ankaret pekar på, när
 * villkoret gäller, vad titeln fylls i med — ligger i en **adapter**
 * (`FollowupAdapter`). Upphandlingarna (§ 39) är första adaptern
 * (`procurement.ts`); nya domäner lägger till en adapter, inte en ny motor.
 *
 * Ingen AI-inferens → ingen riskklass (EU AI Act art. 11: n/a).
 */

import { addDays, addMonths, parseDateOnlyLocal, toDateOnly } from './date-only';

// ─── Regelns gemensamma kärna ───────────────────────────────────────────────

export const FOLLOWUP_REPEATS = ['once', 'monthly', 'quarterly'] as const;
export type FollowupRepeat = (typeof FOLLOWUP_REPEATS)[number];

export const FOLLOWUP_REPEAT_LABELS: Record<FollowupRepeat, string> = {
  once: 'En gång',
  monthly: 'Varje månad',
  quarterly: 'Varje kvartal'
};

export function isFollowupRepeat(v: unknown): v is FollowupRepeat {
  return (FOLLOWUP_REPEATS as readonly string[]).includes(String(v));
}

/** Uppgiftstyper regler får skapa — speglar `tasks.kind`-enumets relevanta värden. */
export const FOLLOWUP_TASK_KINDS = ['followup', 'meeting', 'admin', 'email', 'call', 'prep', 'other'] as const;
export type FollowupTaskKind = (typeof FOLLOWUP_TASK_KINDS)[number];

export function isFollowupTaskKind(v: unknown): v is FollowupTaskKind {
  return (FOLLOWUP_TASK_KINDS as readonly string[]).includes(String(v));
}

/** Fält varje regel måste ha, oavsett domän. Adaptern läser resten (anchor, condition …). */
export interface FollowupRuleBase {
  id: string;
  /** Kan vara negativt ("14 dagar före"). */
  offset_days: number;
  repeat: FollowupRepeat;
  /** Mall — `{{namn}}`-platshållare fylls av adapterns `titleVars`. */
  task_title: string;
  task_kind: FollowupTaskKind;
  active: boolean;
}

export const FOLLOWUP_RULE_NAME_MAX = 120;
export const FOLLOWUP_RULE_TITLE_MAX = 300;
export const FOLLOWUP_RULE_OFFSET_MAX = 730;
/** Hårt tak per regel och mål — en kvartalsregel över ett tvåårsavtal ger 8. */
export const FOLLOWUP_RULE_MAX_OCCURRENCES = 12;
/** Titeln på ett genererat kort cappas (tasks.description). */
export const FOLLOWUP_TITLE_MAX = 500;

/**
 * Validerar den domänoberoende kärnan i en regel. Domänvalidatorer
 * (ankare per scope, villkor per scope) anropar denna FÖRST och lägger sina
 * egna kontroller ovanpå — ingen dubblerad tal-/längdvalidering.
 */
export function validateFollowupRuleBase(raw: {
  name?: unknown;
  offset_days?: unknown;
  repeat?: unknown;
  task_title?: unknown;
  task_kind?: unknown;
  active?: unknown;
}):
  | {
      ok: true;
      value: {
        name: string;
        offset_days: number;
        repeat: FollowupRepeat;
        task_title: string;
        task_kind: FollowupTaskKind;
        active: boolean;
      };
    }
  | { ok: false; error: string } {
  const name = String(raw.name ?? '').trim();
  if (!name) return { ok: false, error: 'Regeln behöver ett namn.' };
  if (name.length > FOLLOWUP_RULE_NAME_MAX) {
    return { ok: false, error: `Namnet får vara max ${FOLLOWUP_RULE_NAME_MAX} tecken.` };
  }
  const offset = Number(raw.offset_days ?? 0);
  if (!Number.isInteger(offset) || Math.abs(offset) > FOLLOWUP_RULE_OFFSET_MAX) {
    return {
      ok: false,
      error: `offset_days måste vara ett heltal mellan -${FOLLOWUP_RULE_OFFSET_MAX} och ${FOLLOWUP_RULE_OFFSET_MAX}.`
    };
  }
  const repeat = String(raw.repeat ?? 'once');
  if (!isFollowupRepeat(repeat)) {
    return { ok: false, error: 'Ogiltig upprepning (once, monthly eller quarterly).' };
  }
  const taskTitle = String(raw.task_title ?? '').trim();
  if (!taskTitle) return { ok: false, error: 'Regeln behöver en uppgiftstitel.' };
  if (taskTitle.length > FOLLOWUP_RULE_TITLE_MAX) {
    return { ok: false, error: `Uppgiftstiteln får vara max ${FOLLOWUP_RULE_TITLE_MAX} tecken.` };
  }
  const taskKind = String(raw.task_kind ?? 'followup');
  if (!isFollowupTaskKind(taskKind)) return { ok: false, error: 'Ogiltig uppgiftstyp.' };
  const active = raw.active === undefined ? true : Boolean(raw.active);
  return { ok: true, value: { name, offset_days: offset, repeat, task_title: taskTitle, task_kind: taskKind, active } };
}

// ─── Titelmall ──────────────────────────────────────────────────────────────

/**
 * Fyller `{{nyckel}}`-platshållare, kollapsar dubbla mellanslag och cappar.
 * Okända platshållare lämnas orörda (synliga, aldrig tyst borttappade).
 */
export function fillFollowupTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
  }
  return out.replace(/\s{2,}/g, ' ').trim().slice(0, FOLLOWUP_TITLE_MAX);
}

// ─── Adapter & plan ─────────────────────────────────────────────────────────

/**
 * Domänadaptern. Byggs per plan med domänens kontext stängd över (t.ex.
 * upphandlingen + dess avrop), så motorn själv aldrig känner till domänen.
 *
 * - `keyPrefix` namnrymmer `rule_key` så två domäner aldrig kolliderar i
 *   `tasks` (unikt index per tenant). Upphandlingarna använder `''` för att
 *   bevara nycklarna på redan skapade kort — nya domäner sätter t.ex. `prog:`.
 * - `targets(rule)` ger målen regeln ska expanderas mot (för ett
 *   "upphandlings-scope" är målet upphandlingen själv → ett element).
 */
export interface FollowupAdapter<R extends FollowupRuleBase, T, X extends object = Record<never, never>> {
  keyPrefix: string;
  targets(rule: R): readonly T[];
  targetId(rule: R, target: T): string;
  /** Regelns urval (t.ex. `applies_to='excellence'`). */
  ruleApplies(rule: R, target: T): boolean;
  /** ÅÅÅÅ-MM-DD för ankaret, eller tomt → regeln ger inget för målet. */
  anchorDate(rule: R, target: T): string | null | undefined;
  /** Upprepade regler löper t.o.m. detta datum (tomt = bara taket begränsar). */
  untilDate(rule: R, target: T): string | null | undefined;
  /** Avbrutet/hävt mål → uppgifterna hamnar i `resolved` (auto-stängs). */
  cancelled(rule: R, target: T): boolean;
  /** Villkoret som håller uppgiften öppen. */
  conditionHolds(rule: R, target: T): boolean;
  /** Platshållare för `task_title`. */
  titleVars(rule: R, target: T): Record<string, string>;
  /** Domänfält som följer med på varje planerad post (länkar, id:n). */
  extra(rule: R, target: T): X;
}

export interface PlannedFollowupBase {
  /** Stabil nyckel `${prefix}${ruleId}:${targetId}:${n}` — idempotens mot `tasks.rule_key`. */
  key: string;
  ruleId: string;
  targetId: string;
  /** ÅÅÅÅ-MM-DD. */
  dueDate: string;
  title: string;
  kind: FollowupTaskKind;
}

export type PlannedFollowupItem<X extends object = Record<never, never>> = PlannedFollowupBase & X;

export interface FollowupPlan<X extends object = Record<never, never>> {
  /** Uppgifter som SKA finnas öppna (villkoret gäller). */
  wanted: PlannedFollowupItem<X>[];
  /** Uppgifter vars villkor UPPHÖRT — befintliga öppna kort får auto-stängas. */
  resolved: PlannedFollowupItem<X>[];
}

function repeatStepMonths(repeat: FollowupRepeat): number {
  return repeat === 'monthly' ? 1 : repeat === 'quarterly' ? 3 : 0;
}

/**
 * Expanderar reglerna mot adapterns mål. Deterministisk: samma indata ⇒ samma
 * nycklar. Upprepade regler löper från ankaret+offset till `untilDate`
 * (hårt tak `maxOccurrences`). Inaktiva regler, saknade ankare och mål utan
 * urval ger inget; avbrutna mål och upphörda villkor hamnar i `resolved`.
 */
export function planFollowups<R extends FollowupRuleBase, T, X extends object = Record<never, never>>(
  adapter: FollowupAdapter<R, T, X>,
  rules: readonly R[],
  opts: { maxOccurrences?: number } = {}
): FollowupPlan<X> {
  const max = opts.maxOccurrences ?? FOLLOWUP_RULE_MAX_OCCURRENCES;
  const wanted: PlannedFollowupItem<X>[] = [];
  const resolved: PlannedFollowupItem<X>[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;
    for (const target of adapter.targets(rule)) {
      if (!adapter.ruleApplies(rule, target)) continue;
      const start = parseDateOnlyLocal(adapter.anchorDate(rule, target));
      if (!start) continue;
      const first = addDays(start, rule.offset_days);
      const until = parseDateOnlyLocal(adapter.untilDate(rule, target));
      const step = repeatStepMonths(rule.repeat);
      const occurrences: string[] = [];
      if (step === 0) {
        occurrences.push(toDateOnly(first));
      } else {
        for (let n = 0; n < max; n++) {
          const d = addMonths(first, n * step);
          if (until && d.getTime() > until.getTime()) break;
          occurrences.push(toDateOnly(d));
        }
      }
      if (occurrences.length === 0) continue;

      const holds = !adapter.cancelled(rule, target) && adapter.conditionHolds(rule, target);
      const targetId = adapter.targetId(rule, target);
      const title = fillFollowupTemplate(rule.task_title, adapter.titleVars(rule, target));
      const extra = adapter.extra(rule, target);
      occurrences.forEach((dueDate, n) => {
        const item = {
          key: `${adapter.keyPrefix}${rule.id}:${targetId}:${n}`,
          ruleId: rule.id,
          targetId,
          dueDate,
          title,
          kind: rule.task_kind,
          ...extra
        } as PlannedFollowupItem<X>;
        (holds ? wanted : resolved).push(item);
      });
    }
  }

  // Stabil ordning: närmast förfallodag först.
  const byDue = (a: PlannedFollowupBase, b: PlannedFollowupBase) =>
    a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key);
  wanted.sort(byDue);
  resolved.sort(byDue);
  return { wanted, resolved };
}

// ─── Diff mot befintliga kort ───────────────────────────────────────────────

export interface ExistingFollowupTask {
  id: string;
  rule_key: string;
  status: string;
  due_at?: string | null;
  description?: string | null;
}

export interface FollowupDiff<X extends object = Record<never, never>> {
  toCreate: PlannedFollowupItem<X>[];
  toUpdate: Array<{ taskId: string; dueDate: string; title: string }>;
  toResolve: string[];
}

/** `tasks.status`-värden som räknas som öppna (kanbanens sex kolumner utom done, § 15.7). */
export const FOLLOWUP_OPEN_STATUSES: ReadonlySet<string> = new Set([
  'backlog',
  'open',
  'in_progress',
  'review',
  'blocked'
]);

/**
 * Diff mellan planen och befintliga regelgenererade uppgifter. Kort som en
 * människa redan flyttat till done/cancelled rörs aldrig. `existing` ska
 * vara domänens egna kort (t.ex. filtrerat på upphandling) — motorn
 * auto-stänger allt öppet i mängden som inte längre är `wanted`.
 */
export function diffFollowups<X extends object>(
  plan: FollowupPlan<X>,
  existing: readonly ExistingFollowupTask[]
): FollowupDiff<X> {
  const byKey = new Map(existing.map((t) => [t.rule_key, t]));
  const wantedKeys = new Set(plan.wanted.map((w) => w.key));
  const toCreate: PlannedFollowupItem<X>[] = [];
  const toUpdate: FollowupDiff<X>['toUpdate'] = [];
  for (const w of plan.wanted) {
    const t = byKey.get(w.key);
    if (!t) {
      toCreate.push(w);
      continue;
    }
    if (!FOLLOWUP_OPEN_STATUSES.has(t.status)) continue;
    const due = (t.due_at || '').slice(0, 10);
    if (due !== w.dueDate || (t.description || '') !== w.title) {
      toUpdate.push({ taskId: t.id, dueDate: w.dueDate, title: w.title });
    }
  }
  const toResolve: string[] = [];
  for (const t of existing) {
    if (!FOLLOWUP_OPEN_STATUSES.has(t.status)) continue;
    if (wantedKeys.has(t.rule_key)) continue;
    toResolve.push(t.id);
  }
  return { toCreate, toUpdate, toResolve };
}

// ─── Skydd för synkens fasta fält ───────────────────────────────────────────

/**
 * Fält synken själv äger på ett genererat kort. En adapters `linkFields` får
 * ALDRIG sätta dem — särskilt inte `startup` (RLS § 21 skulle ge en
 * bolagsmedlem läsning av intern data, § 40.2) eller `tenant`/`rule_key`
 * (idempotens och isolering). Kontrolleras i `syncFollowupTasks`.
 */
export const FOLLOWUP_RESERVED_TASK_FIELDS: ReadonlySet<string> = new Set([
  'tenant',
  'startup',
  'owner',
  'status',
  'link_kind',
  'rule_key',
  'kind',
  'description',
  'due_at',
  'completed_at',
  'id',
  'assignees',
  'created_by'
]);

/** Kastar om länkfälten försöker skriva över ett reserverat fält. */
export function assertSafeFollowupLinkFields(fields: Record<string, unknown>): void {
  const bad = Object.keys(fields).filter((k) => FOLLOWUP_RESERVED_TASK_FIELDS.has(k));
  if (bad.length > 0) {
    throw new Error(`Uppföljningsadaptern får inte sätta ${bad.join(', ')} på genererade kort (§ 40.2).`);
  }
}
