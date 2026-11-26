// SPARK — matchning mellan behov, lösningar och testmiljöer (CLAUDE.md § 61).
//
// Deterministisk och förklarbar: varje förslag bär sina skäl i klartext, och
// en människa på Movexum beslutar om parterna ska presenteras för varandra.
// Ingen AI-inferens. Ren logik, enhetstestad i spark-matching.test.ts.

import { SPARK_ENERGY_AREA_LABELS, SPARK_KOMMUN_LABELS, SPARK_MATURITY_LABELS, SPARK_SECTOR_LABELS } from './spark';

export interface MatchableActor {
  id: string;
  sector?: string;
  kommun?: string;
  pilot_interest?: string;
  need_matching?: string;
  solution_matching?: string;
  status?: string;
}

export interface MatchableNeed {
  id: string;
  actor: string;
  areas: readonly string[];
  priority?: string;
  horizon?: string;
  unmet?: string;
  status?: string;
}

export interface MatchableSolution {
  id: string;
  actor: string;
  areas: readonly string[];
  target_sectors: readonly string[];
  maturity?: number;
  needs: readonly string[];
  status?: string;
}

export interface MatchableTestbed {
  id: string;
  actor: string;
  kind: string;
  areas: readonly string[];
  status?: string;
}

export interface SparkPairScore {
  score: number;
  reasons: string[];
  /** Sådant som talar emot — visas för människan, sänker poängen. */
  cautions: string[];
  sharedAreas: string[];
}

export interface SparkSuggestion<T> extends SparkPairScore {
  item: T;
}

export const SPARK_SUGGESTION_LIMIT = 8;

const AREA_WEIGHT = 4;
const AREA_CAP = 3;
const GENERIC_AREA = 'annat';

function shared(a: readonly string[], b: readonly string[]): string[] {
  return a.filter((x) => x !== GENERIC_AREA && b.includes(x));
}

function listLabels(values: readonly string[], map: Record<string, string>): string {
  return values.map((v) => map[v] ?? v).join(', ');
}

/**
 * Poängsätter ett behov mot en lösning. `null` = paret ska inte föreslås:
 * samma aktör, någon part har sagt nej till matchning, eller varken
 * energiområde eller bransch stämmer.
 */
export function scoreNeedSolution(
  need: MatchableNeed,
  solution: MatchableSolution,
  actors: ReadonlyMap<string, MatchableActor>
): SparkPairScore | null {
  if (need.actor === solution.actor) return null;
  const needActor = actors.get(need.actor);
  const solutionActor = actors.get(solution.actor);
  if (needActor?.need_matching === 'no' || solutionActor?.solution_matching === 'no') return null;
  if (needActor?.status === 'archived' || solutionActor?.status === 'archived') return null;

  const sharedAreas = shared(need.areas, solution.areas);
  const sectorFit = Boolean(needActor?.sector && solution.target_sectors.includes(needActor.sector));
  if (sharedAreas.length === 0 && !sectorFit) return null;

  let score = 0;
  const reasons: string[] = [];
  const cautions: string[] = [];

  if (sharedAreas.length > 0) {
    score += Math.min(sharedAreas.length, AREA_CAP) * AREA_WEIGHT;
    reasons.push(`Samma energiområde: ${listLabels(sharedAreas, SPARK_ENERGY_AREA_LABELS)}`);
  } else {
    cautions.push('Inget gemensamt energiområde — bara branschen stämmer');
  }
  if (sectorFit && needActor?.sector) {
    score += 3;
    reasons.push(`Lösningen riktar sig till ${(SPARK_SECTOR_LABELS[needActor.sector] ?? needActor.sector).toLowerCase()}`);
  }

  const maturity = solution.maturity ?? 0;
  if (maturity > 0) {
    const label = (SPARK_MATURITY_LABELS[String(maturity)] ?? '').toLowerCase();
    if (need.horizon === 'lt1') {
      if (maturity >= 5) {
        score += 2;
        reasons.push(`Lösningen är i ${label} och behovet ska lösas inom ett år`);
      } else if (maturity === 4) {
        score += 1;
        reasons.push('Lösningen testas nu — kan passa som pilot inom ett år');
      } else {
        score -= 1;
        cautions.push(`Lösningen är i ${label} men behovet ska lösas inom ett år`);
      }
    } else if (need.horizon === 'y1_3') {
      if (maturity >= 3) {
        score += 2;
        reasons.push(`Mognaden (${label}) passar en tidshorisont på 1–3 år`);
      } else {
        cautions.push(`Lösningen är i ${label} — tidig för en tidshorisont på 1–3 år`);
      }
    } else if (need.horizon === 'y3_5' || need.horizon === 'gt5') {
      score += 1;
      reasons.push('Lång tidshorisont ger utrymme att utveckla lösningen tillsammans');
    }
  }

  if (need.unmet === 'yes') {
    score += 1;
    reasons.push('Behovsägaren hittar ingen lösning på marknaden i dag');
  }
  if (solution.needs.includes('pilotkund') && (needActor?.pilot_interest === 'yes' || needActor?.pilot_interest === 'maybe')) {
    score += 2;
    reasons.push(
      needActor.pilot_interest === 'yes'
        ? 'Lösningen söker pilotkund och behovsägaren vill vara pilotkund'
        : 'Lösningen söker pilotkund och behovsägaren kan tänka sig det'
    );
  }
  if (need.priority === 'high') {
    score += 1;
    reasons.push('Behovet är högt prioriterat');
  }
  if (needActor?.kommun && needActor.kommun === solutionActor?.kommun && SPARK_KOMMUN_LABELS[needActor.kommun] && !needActor.kommun.startsWith('annan') && !needActor.kommun.startsWith('utanfor')) {
    score += 1;
    reasons.push(`Båda finns i ${SPARK_KOMMUN_LABELS[needActor.kommun]}`);
  }
  if (!needActor?.need_matching) cautions.push('Behovsägaren har inte svarat på om den vill matchas');
  if (!solutionActor?.solution_matching) cautions.push('Innovationsaktören har inte svarat på om den vill matchas');

  return { score, reasons, cautions, sharedAreas };
}

function rank<T extends { id: string }>(rows: (SparkSuggestion<T> | null)[], limit: number): SparkSuggestion<T>[] {
  return rows
    .filter((r): r is SparkSuggestion<T> => r !== null && r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, limit);
}

export interface SparkRankOptions {
  limit?: number;
  /** Id:n som redan är matchade mot utgångsposten och inte ska föreslås igen. */
  exclude?: ReadonlySet<string>;
}

export function rankSolutionsForNeed(
  need: MatchableNeed,
  solutions: readonly MatchableSolution[],
  actors: ReadonlyMap<string, MatchableActor>,
  opts: SparkRankOptions = {}
): SparkSuggestion<MatchableSolution>[] {
  return rank(
    solutions
      .filter((s) => (s.status ?? 'active') === 'active' && !opts.exclude?.has(s.id))
      .map((s) => {
        const scored = scoreNeedSolution(need, s, actors);
        return scored ? { item: s, ...scored } : null;
      }),
    opts.limit ?? SPARK_SUGGESTION_LIMIT
  );
}

export function rankNeedsForSolution(
  solution: MatchableSolution,
  needs: readonly MatchableNeed[],
  actors: ReadonlyMap<string, MatchableActor>,
  opts: SparkRankOptions = {}
): SparkSuggestion<MatchableNeed>[] {
  return rank(
    needs
      .filter((n) => {
        const status = n.status ?? 'open';
        return (status === 'open' || status === 'matched') && !opts.exclude?.has(n.id);
      })
      .map((n) => {
        const scored = scoreNeedSolution(n, solution, actors);
        return scored ? { item: n, ...scored } : null;
      }),
    opts.limit ?? SPARK_SUGGESTION_LIMIT
  );
}

/** Testmiljöer och pilotkunder som passar en lösning. */
export function rankTestbedsForSolution(
  solution: MatchableSolution,
  testbeds: readonly MatchableTestbed[],
  actors: ReadonlyMap<string, MatchableActor>,
  opts: SparkRankOptions = {}
): SparkSuggestion<MatchableTestbed>[] {
  const wantsEnv = solution.needs.includes('testmiljo');
  const wantsPilot = solution.needs.includes('pilotkund');
  return rank(
    testbeds
      .filter((t) => (t.status ?? 'available') === 'available' && t.actor !== solution.actor && !opts.exclude?.has(t.id))
      .map((t) => {
        const owner = actors.get(t.actor);
        if (owner?.status === 'archived') return null;
        const sharedAreas = shared(solution.areas, t.areas);
        const sectorFit = Boolean(owner?.sector && solution.target_sectors.includes(owner.sector));
        if (sharedAreas.length === 0 && !sectorFit) return null;
        let score = 0;
        const reasons: string[] = [];
        const cautions: string[] = [];
        if (sharedAreas.length > 0) {
          score += Math.min(sharedAreas.length, AREA_CAP) * AREA_WEIGHT;
          reasons.push(`Passar energiområdet: ${listLabels(sharedAreas, SPARK_ENERGY_AREA_LABELS)}`);
        }
        if (sectorFit && owner?.sector) {
          score += 3;
          reasons.push(`Rätt bransch: ${SPARK_SECTOR_LABELS[owner.sector] ?? owner.sector}`);
        }
        if (t.kind === 'test_environment' && wantsEnv) {
          score += 2;
          reasons.push('Lösningen behöver en testmiljö');
        } else if (t.kind === 'pilot_customer' && wantsPilot) {
          score += 2;
          reasons.push('Lösningen söker pilotkund');
        } else if (!wantsEnv && !wantsPilot) {
          cautions.push('Lösningen har inte angett att den behöver testmiljö eller pilotkund');
        }
        if ((solution.maturity ?? 0) >= 3 && (solution.maturity ?? 0) <= 4) {
          score += 1;
          reasons.push('Lösningen är i prototyp- eller testfas');
        }
        return { item: t, score, reasons, cautions, sharedAreas };
      }),
    opts.limit ?? SPARK_SUGGESTION_LIMIT
  );
}

export interface SparkAreaBalance {
  area: string;
  needs: number;
  solutions: number;
  testbeds: number;
  /** `gap` = behov utan lösning, `surplus` = lösning utan behov. */
  verdict: 'gap' | 'surplus' | 'balanced' | 'empty';
}

/** Öppna behov, aktiva lösningar och testmiljöer per energiområde — visar var luckorna finns. */
export function sparkAreaBalance(
  areaIds: readonly string[],
  needs: readonly MatchableNeed[],
  solutions: readonly MatchableSolution[],
  testbeds: readonly MatchableTestbed[] = []
): SparkAreaBalance[] {
  return areaIds.map((area) => {
    const n = needs.filter((x) => ['open', 'matched'].includes(x.status ?? 'open') && x.areas.includes(area)).length;
    const s = solutions.filter((x) => (x.status ?? 'active') === 'active' && x.areas.includes(area)).length;
    const t = testbeds.filter((x) => (x.status ?? 'available') === 'available' && x.areas.includes(area)).length;
    const verdict: SparkAreaBalance['verdict'] = n === 0 && s === 0 ? 'empty' : n > 0 && s === 0 ? 'gap' : s > 0 && n === 0 ? 'surplus' : 'balanced';
    return { area, needs: n, solutions: s, testbeds: t, verdict };
  });
}
