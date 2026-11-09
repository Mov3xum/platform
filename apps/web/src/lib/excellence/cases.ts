// Ärenden i Bedömning excellens (CLAUDE.md § 51.10). Ren modul (ingen IO)
// så reglerna för vilket ärende en körning hamnar i kan enhetstestas.
//
// Ett ärende per bolag och tillfälle: körningar, omräkningar och "hämta mer"
// skriver det senaste underlaget till ärendet så det kan fortsättas utan nya
// registeranrop. Ett klarmarkerat ärende lämnar listan över aktuella ärenden.

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

export type CaseTarget = { kind: 'update'; id: string } | { kind: 'create' } | { kind: 'skip' };

/**
 * Vart en körning sparas:
 * 1. Ett uttryckligt ärende (rapporten/ärendevyn skickar `case_id`) — bara
 *    om det gäller SAMMA bolag; ett ärende för ett annat org-nr skrivs aldrig
 *    över (ett manipulerat/inaktuellt id ger i stället regel 2–3).
 * 2. Annars ett PÅGÅENDE ärende för samma org-nr — "Skapa ärende" för ett
 *    bolag som redan har ett öppet ärende fyller på det i stället för att
 *    skapa en dubblett.
 * 3. Annars ett nytt ärende när körningen får skapa ett (`create`), annars
 *    inget (t.ex. omräkning från bolagskortet utan pågående ärende).
 */
export function resolveCaseTarget(args: {
  orgNr: string;
  requested?: CaseCandidate | null;
  openForOrg?: CaseCandidate | null;
  create: boolean;
}): CaseTarget {
  const { orgNr, requested, openForOrg, create } = args;
  if (requested && requested.org_nr === orgNr) return { kind: 'update', id: requested.id };
  if (openForOrg && openForOrg.org_nr === orgNr && openForOrg.status === 'open') return { kind: 'update', id: openForOrg.id };
  return create ? { kind: 'create' } : { kind: 'skip' };
}
