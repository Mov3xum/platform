// De minimis-modul — ren, React-/server-fri beräkningslogik (delas av
// server actions, försäkrans-PDF och UI, och enhetstestas i node:test).
//
// Bakgrund: det finns ingen central uppslagstjänst för en mottagares samlade
// de minimis-summa — ansvaret ligger på företaget ("ett enda företag",
// single undertaking). Den här modulen summerar mottaget stöd per förordning
// mot respektive takbelopp samt mot det samlade taket 300 000 EUR.
//
// VIKTIGT: detta är ett internt stödverktyg, inte ett juridiskt avgörande.
// Slutlig prövning görs alltid av stödgivaren.

// ─── Grundtyper ──────────────────────────────────────────────────────────────

export type ForordningKod = 'ALLMAN' | 'SGEI' | 'JORDBRUK' | 'FISKE';

export type PeriodTyp = 'RULLANDE_3AR' | 'BESKATTNINGSAR_3';

/** Det samlade taket: ett enda företag får totalt max 300 000 EUR (sektorstöd
 * inräknat) under den rullande treårsperioden. */
export const SAMLAT_TAK_EUR = 300000;

export const FORORDNING_KODER: ForordningKod[] = ['ALLMAN', 'SGEI', 'JORDBRUK', 'FISKE'];

/** Konfigurerbar regelverksrad — speglar `de_minimis_regelverk`-collectionen.
 * Default-värdena nedan används som fallback om collectionen inte laddats. */
export interface DeMinimisRegel {
  kod: ForordningKod;
  forordning_text: string;
  tillampning: string;
  tak_eur: number;
  period: PeriodTyp;
  /** ISO-datum (YYYY-MM-DD) t.o.m. vilket taket gäller, eller undefined. */
  giltig_t_o_m?: string;
}

/** Kanoniska defaults (källan av sanning för beloppen) — t.o.m. 2030-12-31. */
export const DEFAULT_DE_MINIMIS_REGELVERK: DeMinimisRegel[] = [
  {
    kod: 'ALLMAN',
    forordning_text: '(EU) 2023/2831',
    tillampning: 'Allmänt stöd av mindre betydelse',
    tak_eur: 300000,
    period: 'RULLANDE_3AR',
    giltig_t_o_m: '2030-12-31'
  },
  {
    kod: 'SGEI',
    forordning_text: '(EU) 2023/2832',
    tillampning: 'Tjänster av allmänt ekonomiskt intresse (SGEI)',
    tak_eur: 750000,
    period: 'RULLANDE_3AR',
    giltig_t_o_m: '2030-12-31'
  },
  {
    kod: 'JORDBRUK',
    forordning_text: '(EU) 1408/2013, senast ändrad (EU) 2024/3118',
    tillampning: 'Primärproduktion av jordbruksprodukter',
    tak_eur: 50000,
    period: 'BESKATTNINGSAR_3',
    giltig_t_o_m: '2030-12-31'
  },
  {
    kod: 'FISKE',
    forordning_text: '(EU) 717/2014',
    tillampning: 'Fiskeri- och vattenbrukssektorn',
    tak_eur: 30000,
    period: 'BESKATTNINGSAR_3',
    giltig_t_o_m: '2030-12-31'
  }
];

export const forordningLabels: Record<ForordningKod, string> = {
  ALLMAN: 'Allmänt',
  SGEI: 'SGEI',
  JORDBRUK: 'Jordbruk',
  FISKE: 'Fiske'
};

/** Minsta delmängd av ett stöd som krävs för summering. */
export interface DeMinimisStodCalc {
  forordning: ForordningKod;
  belopp_eur: number;
  /** ISO-datumsträng (accepterar "YYYY-MM-DD" eller full ISO). */
  beslutsdatum: string;
}

// ─── Datum-hjälpare (utan extern dependency) ─────────────────────────────────

/** Tolkar en datumsträng till ett UTC-datum vid midnatt. Returnerar null vid
 * ogiltigt värde. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const datePart = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** refDatum minus `years` år (samma månad/dag). */
export function subYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Summeringar ─────────────────────────────────────────────────────────────

/**
 * Rullande summa för en förordning vid referensdagen `refDatum`.
 *
 * - RULLANDE_3AR (ALLMAN/SGEI): summerar stöd där beslutsdatum > refDatum − 3 år.
 * - BESKATTNINGSAR_3 (JORDBRUK/FISKE): summerar innevarande beskattningsår
 *   (= kalenderår) + de två föregående. Sektorsreglernas exakta periodtolkning
 *   bör bekräftas mot Jordbruksverket innan produktion.
 */
export function rullandeSummaForordning(
  stod: DeMinimisStodCalc[],
  forordning: ForordningKod,
  period: PeriodTyp,
  refDatum: Date
): number {
  const refYear = refDatum.getUTCFullYear();
  const cutoff = subYears(refDatum, 3);
  let sum = 0;
  for (const s of stod) {
    if (s.forordning !== forordning) continue;
    const d = parseDateOnly(s.beslutsdatum);
    if (!d) continue;
    if (period === 'BESKATTNINGSAR_3') {
      const y = d.getUTCFullYear();
      if (y <= refYear && y >= refYear - 2) sum += s.belopp_eur;
    } else {
      // Strikt större än cutoff (beslut exakt 3 år tillbaka faller utanför).
      if (d.getTime() > cutoff.getTime() && d.getTime() <= refDatum.getTime()) {
        sum += s.belopp_eur;
      }
    }
  }
  return roundCents(sum);
}

/**
 * Samlad summa över SAMTLIGA förordningar mot det gemensamma taket
 * (300 000 EUR). Här används den rullande treårsmodellen för allt stöd
 * (sektorstöd inräknat) — den strängare gemensamma gränsen.
 */
export function samladSumma(stod: DeMinimisStodCalc[], refDatum: Date): number {
  const cutoff = subYears(refDatum, 3);
  let sum = 0;
  for (const s of stod) {
    const d = parseDateOnly(s.beslutsdatum);
    if (!d) continue;
    if (d.getTime() > cutoff.getTime() && d.getTime() <= refDatum.getTime()) {
      sum += s.belopp_eur;
    }
  }
  return roundCents(sum);
}

export type WarningLevel = 'ok' | 'warn' | 'critical' | 'over';

/** Varningsnivå: gul vid ≥ 80 %, röd vid ≥ 95 %, "over" när taket överskrids. */
export function warningLevel(used: number, cap: number): WarningLevel {
  if (cap <= 0) return used > 0 ? 'over' : 'ok';
  if (used > cap + 0.005) return 'over';
  const ratio = used / cap;
  if (ratio >= 0.95) return 'critical';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}

export interface ForordningSummary {
  kod: ForordningKod;
  used: number;
  cap: number;
  remaining: number;
  /** 0–100, klippt. */
  pct: number;
  period: PeriodTyp;
  level: WarningLevel;
}

/** Summering per förordning + samlad rad, vid referensdagen (default idag). */
export function summarize(
  stod: DeMinimisStodCalc[],
  regelverk: DeMinimisRegel[],
  refDatum: Date = new Date()
): { perForordning: ForordningSummary[]; samlat: ForordningSummary } {
  const perForordning = FORORDNING_KODER.map((kod) => {
    const regel = regelverk.find((r) => r.kod === kod);
    const cap = regel?.tak_eur ?? 0;
    const period = regel?.period ?? 'RULLANDE_3AR';
    const used = rullandeSummaForordning(stod, kod, period, refDatum);
    const remaining = roundCents(cap - used);
    const pct = cap > 0 ? Math.max(0, Math.min(100, (used / cap) * 100)) : used > 0 ? 100 : 0;
    return { kod, used, cap, remaining, pct, period, level: warningLevel(used, cap) };
  });

  const samladUsed = samladSumma(stod, refDatum);
  const samlat: ForordningSummary = {
    kod: 'ALLMAN',
    used: samladUsed,
    cap: SAMLAT_TAK_EUR,
    remaining: roundCents(SAMLAT_TAK_EUR - samladUsed),
    pct: Math.max(0, Math.min(100, (samladUsed / SAMLAT_TAK_EUR) * 100)),
    period: 'RULLANDE_3AR',
    level: warningLevel(samladUsed, SAMLAT_TAK_EUR)
  };

  return { perForordning, samlat };
}

// ─── Prövning av nytt stöd ───────────────────────────────────────────────────

export interface KanBeviljaResultat {
  ok: boolean;
  /** Kvarvarande utrymme i förordningen FÖRE det nya stödet. */
  utrymmeForordning: number;
  /** Kvarvarande utrymme i det samlade taket FÖRE det nya stödet. */
  utrymmeSamlat: number;
  /** Hur mycket förordningstaket skulle överskridas (0 om inom). */
  overskridsForordningMed: number;
  /** Hur mycket det samlade taket skulle överskridas (0 om inom). */
  overskridsSamlatMed: number;
  takForordning: number;
}

/**
 * Prövar om ett nytt stöd kan beviljas utan att överskrida vare sig
 * förordningens tak eller det samlade taket (300 000 EUR). Referensdag =
 * det tilltänkta beslutsdatumet.
 */
export function kanBevilja(
  stod: DeMinimisStodCalc[],
  regelverk: DeMinimisRegel[],
  forordning: ForordningKod,
  nyttBelopp: number,
  beslutsdatum: Date
): KanBeviljaResultat {
  const regel = regelverk.find((r) => r.kod === forordning);
  const tak = regel?.tak_eur ?? 0;
  const period = regel?.period ?? 'RULLANDE_3AR';

  const befintligtForordning = rullandeSummaForordning(stod, forordning, period, beslutsdatum);
  const befintligtSamlat = samladSumma(stod, beslutsdatum);

  const nyForordning = roundCents(befintligtForordning + nyttBelopp);
  const nySamlat = roundCents(befintligtSamlat + nyttBelopp);

  const overForordning = Math.max(0, roundCents(nyForordning - tak));
  const overSamlat = Math.max(0, roundCents(nySamlat - SAMLAT_TAK_EUR));

  return {
    ok: overForordning <= 0.005 && overSamlat <= 0.005,
    utrymmeForordning: roundCents(tak - befintligtForordning),
    utrymmeSamlat: roundCents(SAMLAT_TAK_EUR - befintligtSamlat),
    overskridsForordningMed: overForordning,
    overskridsSamlatMed: overSamlat,
    takForordning: tak
  };
}

// ─── Validering av inmatning ─────────────────────────────────────────────────

export interface StodInput {
  forordning: string;
  belopp_eur: number;
  beslutsdatum: string;
  stodgivare: string;
}

export type StodValidationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

/**
 * Validerar ett stöd-formulär: belopp > 0, beslutsdatum ej i framtiden,
 * giltig förordning + stödgivare. Bakåtdaterade poster blockeras INTE — de
 * returneras som en varning (de kan ändra historiken).
 */
export function validateStodInput(
  input: StodInput,
  options: { latestExistingDate?: string | null; today?: Date } = {}
): StodValidationResult {
  const today = options.today ?? new Date();
  const warnings: string[] = [];

  if (!FORORDNING_KODER.includes(input.forordning as ForordningKod)) {
    return { ok: false, error: 'Välj en giltig förordning.' };
  }
  if (!input.stodgivare || !input.stodgivare.trim()) {
    return { ok: false, error: 'Stödgivare måste anges.' };
  }
  if (!Number.isFinite(input.belopp_eur) || input.belopp_eur <= 0) {
    return { ok: false, error: 'Belopp (EUR) måste vara större än 0.' };
  }

  const beslut = parseDateOnly(input.beslutsdatum);
  if (!beslut) {
    return { ok: false, error: 'Ogiltigt beslutsdatum.' };
  }
  // Jämför på dagsnivå (UTC) så "idag" inte felaktigt blir framtid.
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (beslut.getTime() > todayUtc) {
    return { ok: false, error: 'Beslutsdatum kan inte ligga i framtiden.' };
  }

  const latest = parseDateOnly(options.latestExistingDate ?? undefined);
  if (latest && beslut.getTime() < latest.getTime()) {
    warnings.push(
      'Posten är bakåtdaterad i förhållande till befintliga stöd och ändrar därmed den historiska summeringen.'
    );
  }

  return { ok: true, warnings };
}

// ─── PocketBase-record-typer (speglar migrationerna) ─────────────────────────

export interface DeMinimisRegelverkRecord extends DeMinimisRegel {
  id: string;
  sort_order?: number;
  created?: string;
  updated?: string;
}

export interface DeMinimisUnit {
  id: string;
  tenant: string;
  startup: string;
  namn: string;
  created_by?: string;
  created: string;
  updated: string;
}

export interface DeMinimisUnitOrgnr {
  id: string;
  tenant: string;
  unit: string;
  organisationsnummer: string;
  created: string;
  updated: string;
}

export interface DeMinimisStod {
  id: string;
  tenant: string;
  startup: string;
  unit: string;
  forordning: ForordningKod;
  stodgivare: string;
  beslutsdatum: string;
  belopp_eur: number;
  belopp_sek?: number;
  valutakurs?: number;
  syfte?: string;
  beslut_referens?: string;
  dokument?: string;
  registrerad_i_eair?: boolean;
  created_by?: string;
  created: string;
  updated: string;
}
