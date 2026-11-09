// Felsökning mot live (§ 11.8/§ 51.11): det leverantören svarade loggas i
// webbläsarens konsol (DevTools) som en hopfälld grupp, utöver noteringarna
// på sidan. Innehållet är samma som sidan redan visar — noteringar (PII-fria:
// sökvägar, HTTP-status, Roarings maskerade felbesked, fältnamn), varningar,
// kostnad och den tolkade datan. Personnummer finns aldrig i datan.

export interface RegistryConsoleEntry {
  title: string;
  error?: string;
  notes?: Array<{ label: string; notes: string[] }>;
  warnings?: string[];
  data?: Record<string, unknown>;
}

export function logRegistryDiagnostics(entry: RegistryConsoleEntry): void {
  if (typeof console === 'undefined') return;
  try {
    console.groupCollapsed(`[bolagsregister] ${entry.title}${entry.error ? ' — FEL' : ''}`);
    if (entry.error) console.error('Fel:', entry.error);
    for (const n of entry.notes ?? []) {
      if (n.notes.length === 0) continue;
      const failing = n.notes.filter((t) => /HTTP (?!200)\d|nätverksfel|saknas|kunde inte|avvisades/i.test(t));
      console.log(`${n.label}: ${n.notes.length} noteringar${failing.length > 0 ? `, ${failing.length} med fel/saknade fält` : ''}`);
      for (const t of n.notes) (failing.includes(t) ? console.warn : console.log)(`  ${t}`);
    }
    for (const w of entry.warnings ?? []) console.warn(w);
    for (const [k, v] of Object.entries(entry.data ?? {})) if (v !== undefined) console.log(k, v);
    console.groupEnd();
  } catch {
    /* konsolen får aldrig fälla sidan */
  }
}
