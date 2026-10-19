// Ärenden i Bedömning excellens (CLAUDE.md § 51.10). Ren modul (ingen IO)
// så reglerna för vilket ärende en körning hamnar i kan enhetstestas.
//
// Ett ärende per bolag och tillfälle: körningar, omräkningar och "hämta mer"
// skriver det senaste underlaget till ärendet så det kan fortsättas utan nya
// registeranrop. Ett klarmarkerat ärende lämnar listan över aktuella ärenden
// — och kommer tillbaka dit så fort något i det ändras.

/** MÅSTE spegla `screening_cases.status` i migration 1700000200. */
export const SCREENING_CASE_STATUSES = ['open', 'done'] as const;
export type ScreeningCaseStatus = (typeof SCREENING_CASE_STATUSES)[number];

export const SCREENING_CASE_STATUS_LABEL: Record<ScreeningCaseStatus, string> = {
  open: 'Pågående',
  done: 'Klarmarkerat'
};

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isScreeningCaseId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

export function normalizeScreeningCaseStatus(v: unknown): ScreeningCaseStatus {
  return v === 'done' ? 'done' : 'open';
}

/** Ett ärende som körningen kan skrivas till (redan verifierat i tenanten). */
export interface CaseCandidate {
  id: string;
  org_nr: string;
  status: ScreeningCaseStatus;
}

export type CaseTarget = { kind: 'update'; id: string; reopen: boolean } | { kind: 'create' } | { kind: 'skip' };

/**
 * Vart en körning sparas — ett ärende per bolag:
 * 1. Ett uttryckligt ärende (rapporten/ärendevyn skickar `case_id`) — bara
 *    om det gäller SAMMA bolag; ett ärende för ett annat org-nr skrivs aldrig
 *    över (ett manipulerat/inaktuellt id ger i stället regel 2–3).
 * 2. Annars bolagets befintliga ärende (pågående före klarmarkerat) —
 *    "Skapa ärende" för ett bolag som redan har ett ärende fyller på det i
 *    stället för att skapa en dubblett.
 * 3. Annars ett nytt ärende när körningen får skapa ett (`create`), annars
 *    inget.
 * En ändring i ett klarmarkerat ärende öppnar det igen (`reopen`) — det
 * klarmarkerade läget gäller bara den slutbedömning som arkiverades.
 */
export function resolveCaseTarget(args: {
  orgNr: string;
  requested?: CaseCandidate | null;
  existingForOrg?: CaseCandidate | null;
  create: boolean;
}): CaseTarget {
  const { orgNr, requested, existingForOrg, create } = args;
  const pick = requested && requested.org_nr === orgNr ? requested : existingForOrg && existingForOrg.org_nr === orgNr ? existingForOrg : null;
  if (pick) return { kind: 'update', id: pick.id, reopen: pick.status === 'done' };
  return create ? { kind: 'create' } : { kind: 'skip' };
}

/** En körning på bolagskortet (startup_screenings), kompakt. */
export interface ScreeningRunRef {
  id: string;
  startup: string;
  org_nr?: string;
  assessed_at: string;
}

/** Ett befintligt ärende, kompakt (för synken mot körningarna). */
export interface CaseRef {
  id: string;
  startup?: string;
  org_nr: string;
  status: ScreeningCaseStatus;
  completed_at?: string;
}

export interface CaseSyncPlan {
  /** Senaste körningen per bolag som saknar ärende → nytt pågående ärende. */
  create: ScreeningRunRef[];
  /** Klarmarkerade ärenden där bolaget bedömts efter klarmarkeringen → pågående igen. */
  reopen: string[];
}

/**
 * Håller ärendelistan i takt med körningarna på bolagskortet (§ 51.10):
 * ett bolag som bedömts utan att ha ett ärende (t.ex. före ärendena, eller
 * via bolagskortets "Räkna om") får ett pågående ärende, och ett
 * klarmarkerat ärende vars bolag bedömts EFTER klarmarkeringen är ändrat
 * och blir pågående igen. Slutbedömningens egen körning sparas före
 * klarmarkeringen och öppnar därför aldrig ärendet. Ren — IO i cases.server.ts.
 */
/** PB:s datumformat ("2026-10-19 10:00:00.000Z") och ISO jämförs som tid, inte text. */
function ts(v?: string): number {
  if (!v) return NaN;
  return Date.parse(v.includes('T') ? v : v.replace(' ', 'T'));
}

export function planCaseSync(runs: ScreeningRunRef[], cases: CaseRef[], limit = 20): CaseSyncPlan {
  const latest = new Map<string, ScreeningRunRef>();
  for (const r of runs) {
    if (!r.startup) continue;
    const prev = latest.get(r.startup);
    if (!prev || ts(r.assessed_at) > ts(prev.assessed_at)) latest.set(r.startup, r);
  }
  const create: ScreeningRunRef[] = [];
  const reopen = new Set<string>();
  for (const run of [...latest.values()].sort((a, b) => ts(b.assessed_at) - ts(a.assessed_at))) {
    const own = cases.filter((c) => c.startup === run.startup || (!!run.org_nr && c.org_nr === run.org_nr));
    if (own.length === 0) {
      if (create.length < limit) create.push(run);
      continue;
    }
    if (own.some((c) => c.status === 'open')) continue;
    const done = own.find((c) => c.status === 'done' && ts(run.assessed_at) > ts(c.completed_at));
    if (done) reopen.add(done.id);
  }
  return { create, reopen: [...reopen] };
}
