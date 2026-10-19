// Valbara datadelar vid hämtning från ett bolagsregister (CLAUDE.md § 11.8).
//
// REN modul (ingen IO, ingen server-only) — delas av handler-fabriken,
// server-actionerna och klientkomponenternas kryssrutor, och enhetstestas.
//
// Varje del motsvarar ett API-anrop hos leverantören och en skrivväg:
//   basic             → grunddata till bolagskortet (startups)
//   financials        → årsrader inkl. beslutad utdelning, personalkostnad och
//                       bolagsskatt (startup_financials)
//   group_structure   → moder-/dotterbolag (startup_ownership)
//   beneficial_owners → verklig huvudman (startup_ownership)
//   owner_engagements → ägarnas andra bolag (bara uppslag/bedömning, § 51.11 —
//                       skrivs aldrig; kräver grunddata + verklig huvudman)
// En provider deklarerar vilka delar den stödjer; personalen väljer en
// delmängd före varje hämtning. Det som inte väljs anropas inte och skrivs
// inte — befintliga värden från tidigare hämtningar lämnas orörda.

export const REGISTRY_PART_IDS = [
  'basic',
  'financials',
  'group_structure',
  'beneficial_owners',
  'owner_engagements'
] as const;

export type RegistryPartId = (typeof REGISTRY_PART_IDS)[number];

export interface RegistryPartMeta {
  label: string;
  description: string;
  /** Vilken tabell delen skriver till (`none` = bara uppslag, skrivs aldrig). */
  writes: 'startup' | 'financials' | 'ownership' | 'none';
  /** Delar som måste hämtas samtidigt (läggs till automatiskt av `parseRegistryParts`). */
  requires?: RegistryPartId[];
  /** Bara för uppslag (Testa mot org-nr, Bedömning excellens) — aldrig vid synk till bolagskortet. */
  lookupOnly?: boolean;
  /** När priset inte är "per bolag": vad ett anrop avser (visas vid priset). */
  costUnit?: string;
}

export const REGISTRY_PART_META: Record<RegistryPartId, RegistryPartMeta> = {
  basic: {
    label: 'Grunddata',
    description: 'Bolagsform, kommun, bransch, status och registreringsdatum till bolagskortet.',
    writes: 'startup'
  },
  financials: {
    label: 'Bokslut',
    description:
      'Omsättning, anställda, resultat, balansomslutning, eget kapital och beslutad utdelning per år (Roaring: även personalkostnad och bolagsskatt). Utdelningen avgör art. 22-villkoret "har inte delat ut vinst".',
    writes: 'financials'
  },
  group_structure: {
    label: 'Koncernstruktur',
    description: 'Moderbolag och dotterbolag (juridiska personer med org-nr).',
    writes: 'ownership'
  },
  beneficial_owners: {
    label: 'Verklig huvudman',
    description: 'Huvudmännen med namn, ägarandel och kontrollgrund (personnummer lagras aldrig).',
    writes: 'ownership'
  },
  owner_engagements: {
    label: 'Ägarnas andra bolag',
    description:
      'För varje fysisk huvudman: vilka andra bolag personen äger eller kontrollerar, med SNI-kod. Bolag på samma marknad (samma SNI-kod) räknas som anknutna — båda bolagen ska klara kriterierna. Ett anrop per huvudman + grunddata per hittat bolag.',
    writes: 'none',
    requires: ['basic', 'beneficial_owners'],
    lookupOnly: true,
    costUnit: 'per huvudman, plus grunddata per hittat bolag'
  }
};

/**
 * Valet efter att `id` slagits på/av: beroenden följer med när en del slås på,
 * och delar som kräver en avslagen del slås av — i providerns ordning.
 */
export function toggleRegistryPart(
  selected: readonly RegistryPartId[],
  id: RegistryPartId,
  supported: readonly RegistryPartId[]
): RegistryPartId[] {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
    for (const p of supported) if (REGISTRY_PART_META[p].requires?.includes(id)) next.delete(p);
  } else {
    next.add(id);
    for (const dep of REGISTRY_PART_META[id].requires ?? []) if (supported.includes(dep)) next.add(dep);
  }
  return supported.filter((p) => next.has(p));
}

/** Delar som får väljas vid synk till bolagskortet (inte de som bara gäller uppslag). */
export function syncableParts(parts: readonly RegistryPartId[]): RegistryPartId[] {
  return parts.filter((p) => !REGISTRY_PART_META[p].lookupOnly);
}

/** Delar som skriver bokslutsrader (`startup_financials`), i deklarerad ordning. */
export function financialsParts(parts: readonly RegistryPartId[]): RegistryPartId[] {
  return parts.filter((p) => REGISTRY_PART_META[p].writes === 'financials');
}

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
  // Beroenden (t.ex. ägarnas andra bolag kräver verklig huvudman + grunddata)
  // läggs till när providern har dem — kostnaden visas därför för hela paketet.
  for (const id of [...wanted]) {
    for (const dep of REGISTRY_PART_META[id as RegistryPartId].requires ?? []) {
      if (supported.includes(dep)) wanted.add(dep);
    }
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
