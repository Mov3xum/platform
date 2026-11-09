// IRL i Bedömning excellens (CLAUDE.md § 51 / § 52.2) — ren modul.
//
// IRL har EN plats: bolagskortets KTH-bedömning (`startup_readiness_assessments`).
// Bedömning excellens läser den senaste bedömningen därifrån, och nivåer/
// motiveringar som anges i rapporten eller i en begäran om komplettering
// skrivs dit som en ny bedömning — i stället för att leva som en parallell
// kopia i `startups.screening_facts` (incident 2026-10: DevUp hade 1, 3 … på
// bolagskortet men 6, 6, 7, 7 i bedömningen).

import {
  IRL_AXIS_KEYS,
  IRL_AXIS_NOTE_MAX,
  cleanIrlText,
  normalizeIrlAxisNotes,
  normalizeIrlLevel,
  normalizeIrlProfile,
  type IrlAxisNotes,
  type IrlProfile
} from './kth-irl';
import type { ScreeningIrlFacts } from './excellence-facts';

/** En bedömning ur `startup_readiness_assessments`, normaliserad (PB lagrar 0 för "ej bedömd"). */
export interface IrlReading {
  profile: IrlProfile;
  srl: number | null;
  axisNotes: IrlAxisNotes;
  /** YYYY-MM-DD */
  assessedAt?: string;
}

/**
 * Den bedömning som gäller: den senaste raden med minst en KTH-axel (samma
 * rad som bolagskortets radar visar som "senaste"); finns ingen sådan, den
 * senaste raden som bara har SRL (Vinnova-inmatning). `rows` ska vara
 * sorterade nyast först. Rader utan någon giltig nivå hoppas över.
 */
export function latestIrlReading(rows: readonly unknown[]): IrlReading | null {
  let srlOnly: IrlReading | null = null;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const profile = normalizeIrlProfile(r);
    const srl = normalizeIrlLevel(r.srl);
    const at = typeof r.assessed_at === 'string' && r.assessed_at.length >= 10 ? r.assessed_at.slice(0, 10) : undefined;
    const reading: IrlReading = { profile, srl, axisNotes: normalizeIrlAxisNotes(r.axis_notes), assessedAt: at };
    if (Object.keys(profile).length > 0) return reading;
    if (srl !== null && !srlOnly) srlOnly = reading;
  }
  return srlOnly;
}

/** Axlarna i rapporten som också är KTH-axlar (SRL är Vinnovas tillägg). */
const KTH_SCREENING_AXES = ['crl', 'brl', 'tmrl'] as const;

export interface IrlPromotionPlan {
  /** Ny bedömning att skriva på bolagskortet — `null` när inget ändrats eller inget kan skrivas. */
  write: { profile: IrlProfile; srl: number | null; axisNotes: IrlAxisNotes } | null;
  /** Det som blir kvar i `screening_facts.irl` (SRL-motivering; allt när inget kan skrivas). */
  remaining: ScreeningIrlFacts | undefined;
}

/**
 * Hur rapportens/kompletteringens IRL-svar flyttas till bolagskortet:
 * nivåer (CRL/BRL/TMRL/SRL) och motiveringar för KTH-axlarna läggs ovanpå
 * den senaste bedömningen (övriga axlar följer med oförändrade) och blir en
 * ny bedömning — men bara när något faktiskt skiljer sig, så en omräkning
 * aldrig skapar dubbletter. SRL-motiveringen har ingen plats i KTH-
 * bedömningen och stannar i svaren. Kan ingen KTH-axel sättas (bara SRL och
 * ingen tidigare bedömning) stannar allt i svaren.
 */
export function planIrlPromotion(latest: IrlReading | null, facts: ScreeningIrlFacts | undefined): IrlPromotionPlan {
  if (!facts || (!facts.levels && !facts.notes)) return { write: null, remaining: facts };

  const profile: IrlProfile = { ...(latest?.profile ?? {}) };
  const axisNotes: IrlAxisNotes = { ...(latest?.axisNotes ?? {}) };
  let srl = latest?.srl ?? null;
  let changed = false;

  for (const ax of KTH_SCREENING_AXES) {
    const lvl = normalizeIrlLevel(facts.levels?.[ax]);
    if (lvl !== null && profile[ax] !== lvl) {
      profile[ax] = lvl;
      changed = true;
    }
    const note = cleanIrlText(facts.notes?.[ax], IRL_AXIS_NOTE_MAX);
    if (note && axisNotes[ax] !== note) {
      axisNotes[ax] = note;
      changed = true;
    }
  }
  const srlLevel = normalizeIrlLevel(facts.levels?.srl);
  if (srlLevel !== null && srl !== srlLevel) {
    srl = srlLevel;
    changed = true;
  }

  const srlNote = facts.notes?.srl;
  const kept: ScreeningIrlFacts = srlNote ? { notes: { srl: srlNote } } : {};
  const hasKthAxis = IRL_AXIS_KEYS.some((k) => typeof profile[k] === 'number');
  if (!hasKthAxis) return { write: null, remaining: facts };
  return {
    write: changed ? { profile, srl, axisNotes } : null,
    remaining: kept.notes ? kept : undefined
  };
}

/**
 * Manuella IRL-nivåer (och KTH-motiveringar) för axlar som bolagskortet
 * redan har ett värde för är inaktuella kopior — bolagskortet vinner alltid
 * i bedömningen. De tas bort INNAN något sparas eller flyttas, så en gammal
 * siffra i svaren aldrig kan skriva över en nyare bedömning på bolagskortet.
 * Nivåer för axlar som saknas på bolagskortet behålls (de fyller luckan och
 * kan flyttas dit), liksom SRL-motiveringen (den har ingen plats där).
 */
export function dropShadowedIrlLevels(
  facts: ScreeningIrlFacts | undefined,
  platform:
    | (Partial<Record<'crl' | 'brl' | 'tmrl' | 'srl', number | null>> & { notes?: Partial<Record<'crl' | 'brl' | 'tmrl' | 'srl', string>> })
    | null
    | undefined
): ScreeningIrlFacts | undefined {
  if (!facts || !platform) return facts;
  const levels = { ...(facts.levels ?? {}) };
  const notes = { ...(facts.notes ?? {}) };
  for (const ax of ['crl', 'brl', 'tmrl', 'srl'] as const) {
    if (typeof platform[ax] === 'number') delete levels[ax];
  }
  for (const ax of KTH_SCREENING_AXES) {
    if (platform.notes?.[ax]) delete notes[ax];
  }
  const next: ScreeningIrlFacts = {};
  if (Object.keys(levels).length > 0) next.levels = levels;
  if (Object.keys(notes).length > 0) next.notes = notes;
  return next.levels || next.notes ? next : undefined;
}
