/**
 * Integritet för coach-granskningen i workshops (CLAUDE.md § 18).
 *
 * En coach godkänner ett bestämt INNEHÅLL (svar + AI-/pipeline-artefakter).
 * Vid godkännandet stämplas en SHA-256 av den kanoniska JSON:en av det
 * innehållet i `artifacts_json.coach_approved_hash` (ingen ny PB-kolumn).
 * Vid commit jämförs hashen mot det aktuella innehållet — ändrat innehåll
 * efter godkännandet får aldrig committas stämplat som coach-godkänt.
 *
 * Ren logik + node:crypto (server-only), enhetstestad i workshop-review.test.ts.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '@platform/shared';

/**
 * Artefaktnycklar som bara de dedikerade server-actionerna (coach-beslut,
 * commit) får skriva. Prefix som slutar med `_` matchar alla nycklar med
 * prefixet (`coach_decision`, `coach_notes`, `coach_approved_hash` …).
 */
export const PROTECTED_ARTIFACT_KEYS = ['coach_', 'committed_at', 'strategy_id', 'document_url'] as const;

export function isProtectedArtifactKey(key: string): boolean {
  return PROTECTED_ARTIFACT_KEYS.some((p) => (p.endsWith('_') ? key.startsWith(p) : key === p));
}

/**
 * Metadata som skrivs bredvid en AI-/pipeline-utdata (`diagnostic_run_id`,
 * `diagnostic_at`, `<outputKey>_at`) — själva utdatan ingår i hashen, men
 * körnings-id/tidsstämplar gör det inte (klientens lokala kopia saknar dem,
 * så en oförändrad sparning skulle annars se ut som en ändring).
 */
function isRunMetadataKey(key: string): boolean {
  return /_(run_id|at)$/.test(key);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Det innehåll coachen granskar, som kanonisk JSON (stabil nyckelordning). */
export function reviewedContentSnapshot(answers: unknown, artifacts: unknown): string {
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(asRecord(artifacts))) {
    if (isProtectedArtifactKey(k) || isRunMetadataKey(k)) continue;
    content[k] = v;
  }
  return canonicalJson({ answers: asRecord(answers), artifacts: content });
}

export function reviewedContentHash(answers: unknown, artifacts: unknown): string {
  return createHash('sha256').update(reviewedContentSnapshot(answers, artifacts), 'utf8').digest('hex');
}

export type ApprovalCheck =
  | { ok: true }
  | { ok: false; reason: 'not_approved' | 'missing_hash' | 'changed'; error: string };

/**
 * Är coachens godkännande fortfarande giltigt för det AKTUELLA innehållet?
 * Godkännanden utan stämplad hash (gjorda före integritetskontrollen) räknas
 * inte — coachen får godkänna igen.
 */
export function verifyCoachApproval(answers: unknown, artifacts: unknown): ApprovalCheck {
  const a = asRecord(artifacts);
  if (a.coach_decision !== 'approved') {
    return { ok: false, reason: 'not_approved', error: 'Coachen måste godkänna innan dokumentet kan färdigställas.' };
  }
  const stored = typeof a.coach_approved_hash === 'string' ? a.coach_approved_hash : '';
  if (!stored) {
    return {
      ok: false,
      reason: 'missing_hash',
      error: 'Coachens godkännande saknar granskningsstämpel (gjort före integritetskontrollen). Be coachen godkänna igen.'
    };
  }
  if (stored !== reviewedContentHash(answers, a)) {
    return {
      ok: false,
      reason: 'changed',
      error: 'Innehållet har ändrats sedan coachen godkände det. Skicka till coachen igen för ny granskning.'
    };
  }
  return { ok: true };
}

/**
 * Har innehållet ändrats jämfört med det godkända? Med stämplad hash jämförs
 * mot den; saknas hash (äldre godkännande) jämförs före/efter-innehållet.
 */
export function contentChangedSinceApproval(
  before: { answers: unknown; artifacts: unknown },
  after: { answers: unknown; artifacts: unknown }
): boolean {
  const stored = asRecord(before.artifacts).coach_approved_hash;
  if (typeof stored === 'string' && stored) {
    return stored !== reviewedContentHash(after.answers, after.artifacts);
  }
  return (
    reviewedContentSnapshot(before.answers, before.artifacts) !==
    reviewedContentSnapshot(after.answers, after.artifacts)
  );
}

/** Fält som nollställer ett godkännande så att coachen måste granska igen. */
export function clearedApprovalFields(nowIso: string): Record<string, unknown> {
  return {
    coach_decision: null,
    coach_approved_hash: null,
    coach_approval_cleared_at: nowIso,
    coach_review_submitted_at: nowIso
  };
}

export const APPROVAL_CLEARED_WARNING =
  'Ändringarna sparades. Coachens godkännande har tagits bort eftersom innehållet ändrats — coachen behöver granska igen innan dokumentet kan färdigställas.';
