// Import av spärrlista vid byte från Mailchimp (CLAUDE.md § 54.2) — ren,
// IO-fri. Mailchimp exporterar listorna "unsubscribed" och "cleaned" som
// separata CSV:er med kolumnen "Email Address" och tidsstämpeln
// UNSUB_TIME respektive CLEANED_TIME. Avregistrerade, studsade och klagande
// adresser MÅSTE följa med vid bytet — annars mejlar plattformen folk som
// sagt nej och domänryktet rasar första veckan.

import { normalizeEmailAddress, type EmailSuppressionReason } from './email-campaigns';

export const SUPPRESSION_IMPORT_MAX_ROWS = 20000;

export interface SuppressionImportRow {
  email: string;
  reason: EmailSuppressionReason;
  /** Tidpunkt ur filen (ISO) när den gick att tolka. */
  at: string | null;
  /** Mailchimps egen orsak (UNSUB_REASON) — PII-fri etikett. */
  note: string;
}

export interface SuppressionImportResult {
  rows: SuppressionImportRow[];
  /** Hur filen tolkades: vilken kolumn gav adressen, vilken orsak som antogs. */
  detected: { emailColumn: string | null; defaultReason: EmailSuppressionReason; timeColumn: string | null };
  invalid: number;
  duplicates: number;
  warnings: string[];
}

const EMAIL_HEADERS = ['email address', 'email', 'e-post', 'epost', 'e-mail', 'e-mail address', 'mail', 'emailaddress'];
const UNSUB_HEADERS = ['unsub_time', 'unsubscribe_time', 'unsubscribed', 'avregistrerad'];
const CLEANED_HEADERS = ['cleaned_time', 'cleaned', 'bounced', 'studsade'];
const REASON_HEADERS = ['unsub_reason', 'reason', 'orsak', 'status'];

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseTime(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  // Mailchimp: "2024-03-12 09:41:07" (UTC).
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(' ', 'T') + (s.length <= 16 ? ':00' : '') + 'Z' : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Tolkar rubrikrad + datarader. `defaultReason` används när filen inte
 * avslöjar orsaken själv (en "cleaned"-fil känns igen på CLEANED_TIME, en
 * "unsubscribed"-fil på UNSUB_TIME). Statuskolumnen i Mailchimps fullständiga
 * export (`cleaned`/`unsubscribed`) avgör per rad när den finns.
 */
export function parseSuppressionImport(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  defaultReason: EmailSuppressionReason = 'import'
): SuppressionImportResult {
  const normalized = headers.map(norm);
  const find = (candidates: readonly string[]) => normalized.findIndex((h) => candidates.includes(h));
  const emailIdx = find(EMAIL_HEADERS);
  const unsubIdx = find(UNSUB_HEADERS);
  const cleanedIdx = find(CLEANED_HEADERS);
  const reasonIdx = find(REASON_HEADERS);
  const warnings: string[] = [];

  let detectedReason: EmailSuppressionReason = defaultReason;
  if (cleanedIdx >= 0 && unsubIdx < 0) detectedReason = 'bounce';
  else if (unsubIdx >= 0 && cleanedIdx < 0) detectedReason = 'unsubscribe';
  const timeIdx = unsubIdx >= 0 ? unsubIdx : cleanedIdx;

  if (emailIdx < 0) {
    return {
      rows: [],
      detected: { emailColumn: null, defaultReason: detectedReason, timeColumn: null },
      invalid: 0,
      duplicates: 0,
      warnings: ['Hittade ingen kolumn med e-postadresser (t.ex. "Email Address").']
    };
  }

  const seen = new Set<string>();
  const out: SuppressionImportRow[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (let i = 0; i < Math.min(rows.length, SUPPRESSION_IMPORT_MAX_ROWS); i++) {
    const r = rows[i]!;
    const email = normalizeEmailAddress(r[emailIdx]);
    if (!email) {
      if ((r[emailIdx] ?? '').trim()) invalid++;
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    let reason = detectedReason;
    const statusRaw = reasonIdx >= 0 ? (r[reasonIdx] ?? '').trim().toLowerCase() : '';
    if (statusRaw === 'cleaned' || statusRaw.includes('bounce') || statusRaw.includes('studs')) reason = 'bounce';
    else if (statusRaw === 'unsubscribed' || statusRaw.includes('unsub') || statusRaw.includes('avreg')) reason = 'unsubscribe';
    else if (statusRaw.includes('abuse') || statusRaw.includes('spam') || statusRaw.includes('complain')) reason = 'complaint';
    const note = reasonIdx >= 0 && !['cleaned', 'unsubscribed'].includes(statusRaw) ? (r[reasonIdx] ?? '').trim().slice(0, 80) : '';
    out.push({ email, reason, at: timeIdx >= 0 ? parseTime(r[timeIdx] ?? '') : null, note });
  }
  if (rows.length > SUPPRESSION_IMPORT_MAX_ROWS) warnings.push(`Bara de första ${SUPPRESSION_IMPORT_MAX_ROWS} raderna lästes.`);
  if (invalid > 0) warnings.push(`${invalid} rader hade ingen giltig e-postadress och hoppades över.`);
  return {
    rows: out,
    detected: {
      emailColumn: headers[emailIdx] ?? null,
      defaultReason: detectedReason,
      timeColumn: timeIdx >= 0 ? (headers[timeIdx] ?? null) : null
    },
    invalid,
    duplicates,
    warnings
  };
}
