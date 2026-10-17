// Inbjudningar till event (CLAUDE.md § 53.5) — ren, IO-fri logik.
//
// En inbjudan är en rad i deltagarlistan (`event_signups`, stage `invited`)
// med en engångstoken för svaret. Token lagras bara som SHA-256-hash; den
// i klartext finns bara i mejlet. Svarslänken slutar gälla när eventet är
// över. Rättslig grund: berättigat intresse med avregistrering i varje mejl
// (beslut 2026-10) — `contacts.invite_opt_out` respekteras vid varje utskick.

import { eventEffectiveEndMs } from './event-time';

/** Tak per utskick (samma som enkätutskicket, § 47.5). */
export const INVITE_MAX_RECIPIENTS = 500;

/** Svarslänkens token: 32 slumpbytes base64url ⇒ 43 tecken. */
export const RSVP_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isRsvpToken(value: unknown): value is string {
  return typeof value === 'string' && RSVP_TOKEN_RE.test(value);
}

export type RsvpAnswer = 'yes' | 'no' | 'unsubscribe';

export function isRsvpAnswer(value: unknown): value is RsvpAnswer {
  return value === 'yes' || value === 'no' || value === 'unsubscribe';
}

/** Steget en inbjudan hamnar i efter svaret. Avregistrering är också ett nej. */
export function stageForRsvp(answer: RsvpAnswer): 'signup' | 'declined' {
  return answer === 'yes' ? 'signup' : 'declined';
}

/**
 * Svar tas emot till och med eventets slut (svensk tid). Ett event utan
 * giltigt datum tar inte emot svar. Avregistrering gäller alltid.
 */
export function rsvpOpen(
  event: { starts_at?: string | null; ends_at?: string | null },
  now: Date,
  answer: RsvpAnswer
): boolean {
  if (answer === 'unsubscribe') return true;
  if (!event.starts_at) return false;
  const end = eventEffectiveEndMs({ starts_at: event.starts_at, ends_at: event.ends_at ?? undefined });
  return end !== null && now.getTime() <= end;
}

/**
 * Vem en inbjudan går till: en kontakt i kontaktboken, ett användarkonto
 * (bolagsmedlem) eller bara bolagets egen e-postadress. Avgör både
 * dubblettkontrollen och vilken text/avregistrering mejlet får.
 */
export type InviteRecipientKind = 'contact' | 'user' | 'startup';

export interface InviteCandidate {
  id: string;
  email?: string | null;
  invite_opt_out?: boolean | null;
  /** Standard `contact`. */
  kind?: InviteRecipientKind;
}

export interface ExistingInvite {
  contact?: string | null;
  user?: string | null;
  email?: string | null;
}

export interface InviteSkipped {
  optOut: number;
  noEmail: number;
  already: number;
  overCap: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Vilka mottagare som faktiskt kan bjudas in: giltig e-post, inte
 * avregistrerade och inte redan på listan (samma kontakt, samma
 * användarkonto eller samma adress). Behåller ordningen; kapar vid
 * `INVITE_MAX_RECIPIENTS` per utskick.
 */
export function selectInviteRecipients<T extends InviteCandidate>(
  candidates: readonly T[],
  existing: ReadonlyArray<ExistingInvite>
): { invite: T[]; skipped: InviteSkipped } {
  const contactIds = new Set(existing.map((e) => e.contact).filter((v): v is string => Boolean(v)));
  const userIds = new Set(existing.map((e) => e.user).filter((v): v is string => Boolean(v)));
  const emails = new Set(existing.map((e) => (e.email || '').trim().toLowerCase()).filter(Boolean));
  const skipped: InviteSkipped = { optOut: 0, noEmail: 0, already: 0, overCap: 0 };
  const invite: T[] = [];
  for (const c of candidates) {
    const kind = c.kind ?? 'contact';
    const email = (c.email || '').trim().toLowerCase();
    const sameRecord = (kind === 'contact' && contactIds.has(c.id)) || (kind === 'user' && userIds.has(c.id));
    if (sameRecord || (email && emails.has(email))) {
      skipped.already++;
      continue;
    }
    if (c.invite_opt_out === true) {
      skipped.optOut++;
      continue;
    }
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      skipped.noEmail++;
      continue;
    }
    if (invite.length >= INVITE_MAX_RECIPIENTS) {
      skipped.overCap++;
      continue;
    }
    if (kind === 'contact') contactIds.add(c.id);
    if (kind === 'user') userIds.add(c.id);
    emails.add(email);
    invite.push(c);
  }
  return { invite, skipped };
}

/**
 * Sökord ur en fritextsökning i kontaktboken: varje ord måste matcha något
 * fält (namn, organisation, e-post), så "anna svensson" hittar Anna Svensson
 * fast för- och efternamn ligger i olika fält. Max 5 ord à 40 tecken.
 */
export function contactSearchWords(q: unknown): string[] {
  if (typeof q !== 'string') return [];
  const words = q
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((w) => w.trim().slice(0, 40))
    .filter(Boolean);
  return [...new Set(words)].slice(0, 5);
}

/** Matchar en rad alla sökord (i något av fälten)? Samma regel som serverfiltret. */
export function matchesContactSearch(fields: ReadonlyArray<string | null | undefined>, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const hay = fields.map((f) => (f || '').toLowerCase());
  return words.every((w) => hay.some((h) => h.includes(w)));
}
