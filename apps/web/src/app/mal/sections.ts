import { groupGoalNodes, type GoalFilter, type GoalGrouping, type GoalNode, type GoalTree, type Quarter } from '@platform/shared';

/**
 * Områdena på /mal (§ 42.5) — grupperna i vald gruppering. Delas av sidan
 * (server: flikraden i sidhuvudet) och målvyn (klient: vilka grupper som
 * visas). Ren modul utan 'use client' så servern kan anropa den (§ 37.1).
 */

export interface GoalSection {
  key: string;
  label: string;
  sublabel?: string;
  nodes: GoalNode[];
  /** Antal mål i området utan filter (fokusvyn: tomt område = "Inga mål satta"). */
  total: number;
}

/** Flikens id för "alla områden" — kan inte krocka med en gruppnyckel. */
export const ALL_SECTIONS_TAB = '__alla';

export function goalSections(
  tree: GoalTree,
  nodes: readonly GoalNode[],
  grouping: GoalGrouping,
  opts: { personName: (id: string) => string | null; filterActive: boolean }
): GoalSection[] {
  if (grouping !== 'focus') {
    return groupGoalNodes(nodes, grouping, { personName: opts.personName }).map((g) => ({ ...g, total: g.nodes.length }));
  }
  // Fokusvyn visar även tomma fokusområden (där nya mål läggs till); Projektmål först när det används.
  return tree.areas
    .map((area) => ({
      key: area.area as string,
      label: area.label,
      nodes: nodes.filter((n) => n.goal.focus_area === area.area),
      total: area.goals.length
    }))
    .filter((g) => (opts.filterActive ? g.nodes.length > 0 : !(g.key === 'projekt' && g.total === 0)));
}

/** Query-sträng för /mal med år, kvartal, gruppering, filter och område (tomma värden utelämnas). */
export function goalsQuery(
  base: { ar: number; q: Quarter },
  grouping: GoalGrouping,
  filter: GoalFilter,
  section: string | null = null
): string {
  const p = new URLSearchParams({ ar: String(base.ar), q: String(base.q) });
  if (grouping !== 'focus') p.set('grupp', grouping);
  if (section) p.set('omrade', section);
  if (filter.team) p.set('team', filter.team);
  if (filter.level) p.set('niva', filter.level);
  if (filter.responsible) p.set('ansvarig', filter.responsible);
  if (filter.status) p.set('status', filter.status);
  if (filter.focusArea) p.set('fokus', filter.focusArea);
  if (filter.query?.trim()) p.set('sok', filter.query.trim());
  return p.toString();
}
