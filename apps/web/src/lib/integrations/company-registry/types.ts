/**
 * Gemensam, leverantörsoberoende form för bolagsregisterdata — REN modul
 * (bara typer + små rena hjälpare, inget `server-only`) så normaliserarna kan
 * enhetstestas. Varje bolagsregister-provider (Roaring, Bolagsverket,
 * Allabolag-stubben) mappar sitt API-svar hit; `writer.ts` skriver formen
 * till `startups`, `startup_financials` och `startup_ownership`.
 *
 * Dataminimering (CLAUDE.md § 10.2, § 11.4): formen innehåller BARA
 * whitelistade verksamhetsfält. Fysiska personer i ägarbilden bär inget namn
 * och inget personnummer — bara att det är en person och hur stor andel/vilket
 * kontrollintervall som gäller (det räcker för Bizmaker-kartans regler om
 * fristående/partner/anknutet företag och grundarägande ≥ 75 %).
 */

import type { RegistryPartId } from './parts';

export type RegistrySource = 'roaring' | 'bolagsverket' | 'allabolag';

/** Bolagsstatus som `startups.bolag_status`-enumet känner (migration 1700000058). */
export type BolagStatus = 'aktiv' | 'vilande' | 'konkurs' | 'likvidering' | 'avregistrerat';

export interface RegistryStartupPatch {
  bolagsform?: string;
  kommun?: string;
  industri?: string;
  sni_code?: string;
  sni_description?: string;
  bolag_status?: BolagStatus;
  /** ISO-datum (YYYY-MM-DD) — bolagets registreringsdatum. */
  company_registered_at?: string;
}

export interface RegistryFinancialsYear {
  year: number;
  employees?: number;
  revenue_sek?: number;
  personnel_cost_sek?: number;
  corporate_tax_sek?: number;
  /** Balansomslutning (tröskelvärde art. 22 GBER / SMF-definitionen). */
  balance_sheet_sek?: number;
  /** Eget kapital ("ej marknadsredo": eget kapital < omkostnader 24 mån). */
  equity_sek?: number;
  /** Årets resultat efter skatt. */
  net_result_sek?: number;
}

/** Riktning: `owner` = ägaren äger startup-bolaget; `holding` = startup-bolaget äger. */
export type OwnershipDirection = 'owner' | 'holding';

/**
 * `company`        juridisk person (namn + org-nr lagras)
 * `person`         fysisk person — ALDRIG namn/personnummer, bara andel
 * `public_body`    stat/kommun/universitet (undantagna investerare, art. 3 bilaga I)
 * `investor`       institutionell investerare / VC / affärsängel (undantag)
 * `other`          okänd typ
 */
export type OwnerKind = 'company' | 'person' | 'public_body' | 'investor' | 'other';

export interface RegistryOwnershipEntry {
  direction: OwnershipDirection;
  owner_kind: OwnerKind;
  /** Bolagsnamn. Tomt för fysiska personer (dataminimering). */
  name?: string;
  /** Org-nr (10 siffror) för juridiska personer. Tomt för fysiska personer. */
  org_nr?: string;
  /** Exakt kapitalandel i procent när källan ger den. */
  capital_pct?: number;
  /** Exakt röstandel i procent när källan ger den. */
  voting_pct?: number;
  /** Intervall (t.ex. verklig huvudman "25–50 %") när källan bara ger spann. */
  pct_min?: number;
  pct_max?: number;
  /** Källans egen beskrivning av kontrollgrund (t.ex. "Äger aktier", "Styrelse"). */
  control_basis?: string;
  /** Indirekt ägande via mellanliggande bolag (koncernträd). */
  indirect?: boolean;
  /**
   * Vilken datadel raden kom från (t.ex. `group_structure`,
   * `beneficial_owners`). Gör att en hämtning av bara en ägardel ersätter
   * enbart den delens rader (§ 11.8, `startup_ownership.source_part`).
   */
  part?: RegistryPartId;
}

export interface RegistryCompany {
  /** Normaliserat org-nr (10 siffror). */
  org_nr: string;
  /** Sant när org-nr är personnummer-derivat (enskild firma). */
  isPersonal: boolean;
  /** Bolagsnamn enligt registret (lagras inte på startups, används i förhandsgranskning). */
  name?: string;
  startup: RegistryStartupPatch;
  financials: RegistryFinancialsYear[];
  ownership: RegistryOwnershipEntry[];
  /**
   * Datadelar som hämtades MED LYCKAT RESULTAT. Bara dessa skrivs; en del som
   * inte valdes, eller vars anrop föll, lämnar befintliga värden orörda.
   * Sätts av handler-fabriken.
   */
  fetchedParts?: RegistryPartId[];
  /**
   * PII-fria diagnosnoteringar från normaliseraren ("balansomslutning saknas i
   * svaret", "ägarbild stöds inte av källan"). Visas i förhandsgranskningen så
   * att fältmappningen kan verifieras mot en riktig leverantörsrespons.
   */
  notes: string[];
}

/** Hämtar `obj.a.b.c` tolerant; returnerar undefined vid varje avbrott. */
export function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Första definierade värdet bland flera kandidatsökvägar (fältnamn skiljer sig mellan API-versioner). */
export function pickFirst(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = pick(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function asString(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Tolkar tal även när API:t skickar dem som strängar ("1 141 000", "12,5"). */
export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(/[^0-9,.-]/g, '').replace(',', '.');
    if (cleaned === '' || cleaned === '-') return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** ISO-datum (YYYY-MM-DD) ur ISO-sträng, "2023-07-01T00:00:00" eller "20230701". */
export function asIsoDate(v: unknown): string | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return iso;
}

/** Klampar en procentandel till 0–100 eller ger undefined. */
export function asPct(v: unknown): number | undefined {
  const n = asNumber(v);
  if (n === undefined) return undefined;
  if (n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

/**
 * Tolkar ett intervall som "25-50", "25–50 %", ">75", "<25" till [min, max].
 * Används för verklig huvudman-kontrollintervall.
 */
export function parsePctInterval(v: unknown): { min: number; max: number } | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const range = s.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a <= 100 && b <= 100) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const gt = s.match(/^[>≥]\s*(\d{1,3})/);
  if (gt) return { min: Number(gt[1]), max: 100 };
  const lt = s.match(/^[<≤]\s*(\d{1,3})/);
  if (lt) return { min: 0, max: Number(lt[1]) };
  const single = asPct(s);
  if (single !== undefined) return { min: single, max: single };
  return undefined;
}

/**
 * Mappar leverantörens statusord till `startups.bolag_status`. Tolerant mot
 * svenska/engelska koder; okänt → undefined (vi skriver hellre inget än fel).
 */
export function mapBolagStatus(v: unknown): BolagStatus | undefined {
  const s = asString(v)?.toLowerCase();
  if (!s) return undefined;
  if (/konkurs|bankrupt/.test(s)) return 'konkurs';
  if (/likvid/.test(s)) return 'likvidering';
  if (/avregist|deregist|upphör|dissolv|avförd/.test(s)) return 'avregistrerat';
  if (/vilande|dormant|inaktiv|inactive/.test(s)) return 'vilande';
  if (/aktiv|active|registrer|bolaget är|verksam/.test(s)) return 'aktiv';
  return undefined;
}

/**
 * Härleder ägartyp ur namn/kod. Universitet, kommuner och statliga organ är
 * undantagna vid partner-beräkningen (bilaga I art. 3.2) — därför egen typ.
 */
export function inferOwnerKindFromName(name: string | undefined, fallback: OwnerKind = 'company'): OwnerKind {
  const s = (name || '').toLowerCase();
  if (!s) return fallback;
  if (/universit|högskol|hogskol|kommun|landsting|region |staten|myndighet|forskningsinstitut|rise ab/.test(s)) {
    return 'public_body';
  }
  if (/venture|capital|invest|fond|fund|holding|ventures|almi/.test(s)) return 'investor';
  return fallback;
}

/**
 * Kontrollgrund som FAST vokabulär — leverantörens fritext ("Äger aktier",
 * "Kontroll via avtal med …") kan bära namn och når därför aldrig databasen
 * eller AI-kontexten oöversatt. Okänt → 'other'.
 */
export type ControlBasis = 'shares' | 'votes' | 'board' | 'agreement' | 'other';

export function controlBasisCategory(raw: unknown): ControlBasis | undefined {
  const s = asString(raw)?.toLowerCase();
  if (!s) return undefined;
  if (/styrelse|board|director|ledning|utse|appoint/.test(s)) return 'board';
  if (/avtal|agreement|contract|stadg|bylaw|articles/.test(s)) return 'agreement';
  if (/röst|rost|vot/.test(s)) return 'votes';
  if (/aktie|share|äg|ag[ae]r|own|kapital|capital|equity/.test(s)) return 'shares';
  return 'other';
}

/**
 * Bas-URL för en bolagsregister-leverantör måste vara https och peka på en
 * känd värd — tenanten anger fältet själv, och client secret skickas dit via
 * Basic-auth (SSRF-/hemlighetsläckage-skydd, CLAUDE.md § 10.3 A.8.9/A.8.24).
 * Returnerar den normaliserade URL:en (utan avslutande snedstreck) eller
 * kastar med ett PII-fritt fel.
 */
export function assertAllowedBaseUrl(raw: string, allowedHostSuffixes: string[]): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Bas-URL:en är inte en giltig adress.');
  }
  if (url.protocol !== 'https:') throw new Error('Bas-URL:en måste använda https.');
  if (url.username || url.password) throw new Error('Bas-URL:en får inte innehålla inloggning.');
  const host = url.hostname.toLowerCase();
  const ok = allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!ok) throw new Error(`Bas-URL:ens värd tillåts inte (${host}).`);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
}

/** Tar bort dubbletter (samma riktning + org-nr, eller identisk person-rad). */
export function dedupeOwnership(entries: RegistryOwnershipEntry[]): RegistryOwnershipEntry[] {
  const seen = new Set<string>();
  const out: RegistryOwnershipEntry[] = [];
  for (const e of entries) {
    const key = [
      e.direction,
      e.owner_kind,
      e.org_nr || '',
      e.name || '',
      e.capital_pct ?? '',
      e.voting_pct ?? '',
      e.pct_min ?? '',
      e.pct_max ?? '',
      // Per datadel: en rad från koncernstrukturen slås aldrig ihop med en
      // huvudmansrad (de ersätts var för sig, § 11.8).
      e.part || ''
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
