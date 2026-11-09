// Programsteg på portföljöversikten (/startups) — ren modul, enhetstestad.
//
// Portföljöversikten visar bolagen i fyra programsteg — Formation,
// Incubation, Acceleration och Alumni — i stället för de åtta råa faserna.
// IRL per steg hämtas ALLTID ur bolagets KTH IRL-bedömning
// (`startup_readiness_assessments`, CLAUDE.md § 52.2) — samma rad som
// bolagskortets radar visar som senaste — aldrig ur `startups.irl_level`,
// som bara är en reserv när ingen bedömning finns.

import type { StartupPhase } from './index';
import { latestIrlReading } from './excellence-irl';
import { summarizeIrl } from './kth-irl';

export const PROGRAM_STAGES = ['formation', 'incubation', 'acceleration', 'alumni'] as const;
export type ProgramStage = (typeof PROGRAM_STAGES)[number];

export const PROGRAM_STAGE_LABEL: Record<ProgramStage, string> = {
  formation: 'Formation',
  incubation: 'Incubation',
  acceleration: 'Acceleration',
  alumni: 'Alumni'
};

/** Vilka råa faser som ingår i varje programsteg (visas som hjälptext). */
export const PROGRAM_STAGE_PHASES: Record<ProgramStage, readonly StartupPhase[]> = {
  formation: ['inflode', 'lead', 'boost_chamber'],
  incubation: ['incubation'],
  acceleration: ['prescale', 'acceleration'],
  alumni: ['alumni']
};

/**
 * Programsteg för en fas. `paus` (pausat bolag) hör inte till något steg och
 * ger `null` — räknas separat så summan av stegen aldrig ljuger.
 */
export function programStageOfPhase(phase: string | null | undefined): ProgramStage | null {
  for (const stage of PROGRAM_STAGES) {
    if ((PROGRAM_STAGE_PHASES[stage] as readonly string[]).includes(String(phase ?? ''))) return stage;
  }
  return null;
}

/**
 * Bolagets gällande IRL-snitt per bolag ur rader i `startup_readiness_assessments`
 * (valfri ordning). Per bolag väljs samma rad som `latestIrlReading` — den
 * senaste med minst en KTH-axel — och snittet räknas med `summarizeIrl`.
 * Rader utan `startup` eller utan någon KTH-axel ger inget värde.
 */
export function irlAverageByStartup(rows: readonly unknown[]): Map<string, number> {
  const byStartup = new Map<string, Record<string, unknown>[]>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const startup = typeof r.startup === 'string' ? r.startup : '';
    if (!startup) continue;
    const list = byStartup.get(startup) ?? [];
    list.push(r);
    byStartup.set(startup, list);
  }
  const out = new Map<string, number>();
  for (const [startup, list] of byStartup) {
    list.sort((a, b) => String(b.assessed_at ?? '').localeCompare(String(a.assessed_at ?? '')));
    const reading = latestIrlReading(list);
    if (!reading) continue;
    const avg = summarizeIrl(reading.profile).average;
    if (avg !== null) out.set(startup, avg);
  }
  return out;
}

export interface ProgramStageSummary {
  stage: ProgramStage;
  label: string;
  /** Antal bolag i steget. */
  count: number;
  /** Andel av alla bolag i underlaget (inkl. pausade), heltal 0–100. */
  pct: number;
  /** Antal bolag i steget med en KTH IRL-bedömning. */
  assessed: number;
  /** Medel av bolagens IRL-snitt (en decimal); null när inget bolag i steget är bedömt. */
  irlAverage: number | null;
}

export interface ProgramStagesOverview {
  stages: ProgramStageSummary[];
  /** Bolag som inte hör till något steg (`paus`/okänd fas). */
  unstaged: number;
  /** Portföljens IRL-snitt över alla bedömda bolag; null utan bedömningar. */
  irlAverage: number | null;
  /** Antal bolag med bedömning. */
  assessed: number;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Sammanfattar portföljen per programsteg. `irlByStartup` kommer ur
 * `irlAverageByStartup`; ett bolag utan bedömning räknas i `count` men inte i
 * IRL-snittet (ett saknat värde är aldrig 0).
 */
export function summarizeProgramStages(
  startups: ReadonlyArray<{ id: string; phase: string }>,
  irlByStartup: ReadonlyMap<string, number>
): ProgramStagesOverview {
  const total = startups.length;
  const buckets = new Map<ProgramStage, { count: number; irl: number[] }>(
    PROGRAM_STAGES.map((s) => [s, { count: 0, irl: [] }])
  );
  let unstaged = 0;
  const allIrl: number[] = [];
  for (const s of startups) {
    const stage = programStageOfPhase(s.phase);
    const irl = irlByStartup.get(s.id);
    if (typeof irl === 'number') allIrl.push(irl);
    if (!stage) {
      unstaged += 1;
      continue;
    }
    const b = buckets.get(stage)!;
    b.count += 1;
    if (typeof irl === 'number') b.irl.push(irl);
  }
  const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    stages: PROGRAM_STAGES.map((stage) => {
      const b = buckets.get(stage)!;
      return {
        stage,
        label: PROGRAM_STAGE_LABEL[stage],
        count: b.count,
        pct: total > 0 ? Math.round((b.count / total) * 100) : 0,
        assessed: b.irl.length,
        irlAverage: mean(b.irl)
      };
    }),
    unstaged,
    irlAverage: mean(allIrl),
    assessed: allIrl.length
  };
}
