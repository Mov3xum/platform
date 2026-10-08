// Valbara datadelar vid hämtning från ett bolagsregister (CLAUDE.md § 11.8).
//
// REN modul (ingen IO, ingen server-only) — delas av handler-fabriken,
// server-actionerna och klientkomponenternas kryssrutor, och enhetstestas.
//
// Varje del motsvarar ett API-anrop hos leverantören och en skrivväg:
//   basic             → grunddata till bolagskortet (startups)
//   financials        → årsrader (startup_financials)
//   group_structure   → moder-/dotterbolag (startup_ownership)
//   beneficial_owners → verklig huvudman, anonymt (startup_ownership)
// En provider deklarerar vilka delar den stödjer; personalen väljer en
// delmängd före varje hämtning. Det som inte väljs anropas inte och skrivs
// inte — befintliga värden från tidigare hämtningar lämnas orörda.

export const REGISTRY_PART_IDS = [
  'basic',
  'financials',
  'group_structure',
  'beneficial_owners'
] as const;

export type RegistryPartId = (typeof REGISTRY_PART_IDS)[number];

export interface RegistryPartMeta {
  label: string;
  description: string;
  /** Vilken tabell delen skriver till. */
  writes: 'startup' | 'financials' | 'ownership';
}

export const REGISTRY_PART_META: Record<RegistryPartId, RegistryPartMeta> = {
  basic: {
    label: 'Grunddata',
    description: 'Bolagsform, kommun, bransch, status och registreringsdatum till bolagskortet.',
    writes: 'startup'
  },
  financials: {
    label: 'Bokslut',
    description: 'Omsättning, anställda, resultat, balansomslutning och eget kapital per år.',
    writes: 'financials'
  },
  group_structure: {
    label: 'Koncernstruktur',
    description: 'Moderbolag och dotterbolag (juridiska personer med org-nr).',
    writes: 'ownership'
  },
  beneficial_owners: {
    label: 'Verklig huvudman',
    description: 'Ägarandel och kontrollgrund per huvudman — utan namn eller personnummer.',
    writes: 'ownership'
  }
};

export function isRegistryPartId(v: unknown): v is RegistryPartId {
  return typeof v === 'string' && (REGISTRY_PART_IDS as readonly string[]).includes(v);
}

/** Delar som skriver till ägarbilden, i deklarerad ordning. */
export function ownershipParts(parts: readonly RegistryPartId[]): RegistryPartId[] {
  return parts.filter((p) => REGISTRY_PART_META[p].writes === 'ownership');
}

export type ParsedRegistryParts =
  | { ok: true; parts: RegistryPartId[] }
  | { ok: false; error: string };

/**
 * Tolkar personalens val (formulärvärden) mot de delar providern stödjer.
 * Okända värden och delar providern inte har avvisas — klienten är aldrig
 * säkerhetsgränsen. Saknas valet helt (`undefined`) hämtas allt providern
 * stödjer, så äldre anropare beter sig som förut. Ett tomt val är ett fel.
 * Resultatet följer providerns ordning och är fritt från dubbletter.
 */
export function parseRegistryParts(
  raw: readonly unknown[] | undefined,
  supported: readonly RegistryPartId[]
): ParsedRegistryParts {
  if (raw === undefined) return { ok: true, parts: [...supported] };
  const wanted = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id) continue;
    if (!isRegistryPartId(id) || !supported.includes(id)) {
      return { ok: false, error: `Okänd datadel för leverantören: ${id.slice(0, 40)}` };
    }
    wanted.add(id);
  }
  const parts = supported.filter((p) => wanted.has(p));
  if (parts.length === 0) return { ok: false, error: 'Välj minst en datadel att hämta.' };
  return { ok: true, parts };
}

/** Läsbar lista för sammanfattningar och audit ("Grunddata, Bokslut"). */
export function describeRegistryParts(parts: readonly RegistryPartId[]): string {
  return parts.map((p) => REGISTRY_PART_META[p].label).join(', ');
}

/**
 * Hur ägarbilden ska ersättas efter en hämtning.
 *   none    — ingen ägardel hämtades med lyckat resultat: rör inget.
 *   all     — varje ägardel providern har hämtades: ersätt källans hela
 *             ägarbild (fungerar även mot ett schema utan `source_part`).
 *   partial — bara vissa ägardelar: ersätt enbart deras rader.
 */
export function ownershipReplaceMode(
  fetched: readonly RegistryPartId[],
  supported: readonly RegistryPartId[]
): { mode: 'none' | 'all' | 'partial'; parts: RegistryPartId[] } {
  const all = ownershipParts(supported);
  const got = ownershipParts(supported.filter((p) => fetched.includes(p)));
  if (got.length === 0) return { mode: 'none', parts: [] };
  if (got.length === all.length) return { mode: 'all', parts: got };
  return { mode: 'partial', parts: got };
}
