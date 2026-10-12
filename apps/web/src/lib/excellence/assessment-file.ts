// REN modul (ingen IO): filnamn och metadata för den sparade bedömningen
// (CLAUDE.md § 51.3). Delas av server-actionen och testerna.

/** Ämnesmapp i Filer (§ 24.2) där bedömningar läggs. */
export const EXCELLENCE_FILE_TOPIC = 'rapporter_uppfoljning' as const;

function safeSegment(s: string, max = 60): string {
  return s
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * "Bedömning excellens – <bolag> – 2026-10-12 14.05.pdf". Bolagsnamnet saneras
 * från filsystemstecken; saknas namn används org-nr (aktiebolag — enskild firma
 * slås aldrig upp, § 11.8). Tiden anges i svensk tid så två körningar samma
 * dag inte skriver över varandra i listan.
 */
export function excellenceAssessmentFilename(input: {
  subjectName?: string;
  orgNr: string;
  assessedAt: string | Date;
}): string {
  const d = typeof input.assessedAt === 'string' ? new Date(input.assessedAt) : input.assessedAt;
  const stamp = Number.isNaN(d.getTime())
    ? 'okänt-datum'
    : d
        .toLocaleString('sv-SE', {
          timeZone: 'Europe/Stockholm',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
        .replace(':', '.');
  const name = safeSegment(input.subjectName || '') || safeSegment(input.orgNr) || 'okänt bolag';
  return `Bedömning excellens – ${name} – ${stamp}.pdf`;
}
