/**
 * Bolagskortets flikar (`/startups/[id]/…`) och hur gamla ankarlänkar från
 * den tidigare långa sidan (`/startups/<id>#de-minimis` m.fl. — finns kvar i
 * sparade notiser, aktivitetsloggen och bokmärken) leder till rätt flik.
 * Ren modul, delad av skalet (klient), HashRedirect och testerna.
 */

export type StartupTabId =
  | 'overview'
  | 'utveckling'
  | 'aktiviteter'
  | 'verktyg'
  | 'ekonomi'
  | 'dokument'
  | 'natverk'
  | 'logg';

export interface StartupTab {
  id: StartupTabId;
  label: string;
  /** Sökväg efter `/startups/<id>` ('' = översikten). */
  path: string;
}

export const STARTUP_TABS: readonly StartupTab[] = [
  { id: 'overview', label: 'Översikt', path: '' },
  { id: 'utveckling', label: 'Utveckling & IRL', path: '/utveckling' },
  { id: 'aktiviteter', label: 'Aktiviteter', path: '/aktiviteter' },
  { id: 'verktyg', label: 'Verktyg', path: '/verktyg' },
  { id: 'ekonomi', label: 'Ekonomi & statsstöd', path: '/ekonomi' },
  { id: 'dokument', label: 'Avtal & dokument', path: '/dokument' },
  { id: 'natverk', label: 'Team & nätverk', path: '/natverk' },
  { id: 'logg', label: 'Logg', path: '/logg' }
] as const;

export function startupTabHref(startupId: string, tab: StartupTabId, anchor?: string): string {
  const t = STARTUP_TABS.find((x) => x.id === tab) ?? STARTUP_TABS[0];
  return `/startups/${startupId}${t.path}${anchor ? `#${anchor}` : ''}`;
}

export function activeStartupTab(pathname: string, startupId: string): StartupTabId {
  const base = `/startups/${startupId}`;
  for (const t of STARTUP_TABS) {
    if (t.path && (pathname === `${base}${t.path}` || pathname.startsWith(`${base}${t.path}/`))) return t.id;
  }
  return 'overview';
}

/** Gammalt ankare på översikten → { flik, nytt ankare }. */
const LEGACY_ANCHORS: Record<string, { tab: StartupTabId; anchor: string }> = {
  readiness: { tab: 'utveckling', anchor: 'irl' },
  irl: { tab: 'utveckling', anchor: 'irl' },
  arbete: { tab: 'utveckling', anchor: 'arbete' },
  milestones: { tab: 'utveckling', anchor: 'milestones' },
  'phase-history': { tab: 'utveckling', anchor: 'phase-history' },
  workshops: { tab: 'utveckling', anchor: 'workshops' },
  ipr: { tab: 'utveckling', anchor: 'ipr' },
  actionplan: { tab: 'utveckling', anchor: 'milestones' },
  tools: { tab: 'verktyg', anchor: '' },
  financials: { tab: 'ekonomi', anchor: 'financials' },
  agarbild: { tab: 'ekonomi', anchor: 'agarbild' },
  partners: { tab: 'ekonomi', anchor: 'kapital' },
  kapital: { tab: 'ekonomi', anchor: 'kapital' },
  'de-minimis': { tab: 'ekonomi', anchor: 'de-minimis' },
  stodcheckar: { tab: 'ekonomi', anchor: 'stodcheckar' },
  statsstod: { tab: 'ekonomi', anchor: 'statsstod' },
  upphandlingar: { tab: 'ekonomi', anchor: 'upphandlingar' },
  agreements: { tab: 'dokument', anchor: 'agreements' },
  kunskap: { tab: 'dokument', anchor: 'godkannanden' },
  documents: { tab: 'dokument', anchor: '' },
  'edu-documents': { tab: 'dokument', anchor: 'utbildningsdokument' },
  team: { tab: 'natverk', anchor: 'team' },
  kontakter: { tab: 'natverk', anchor: 'kontakter' },
  moten: { tab: 'natverk', anchor: 'moten' },
  'team-uppdrag': { tab: 'natverk', anchor: 'team-uppdrag' },
  uppfoljning: { tab: 'natverk', anchor: 'uppfoljning' },
  worktime: { tab: 'logg', anchor: '' },
  activities: { tab: 'logg', anchor: '' }
};

/**
 * Var ett gammalt ankare på översikten hör hemma nu, eller null när det
 * fortfarande finns på översikten (t.ex. `#notes`) eller är okänt.
 */
export function legacyStartupAnchorTarget(
  startupId: string,
  hash: string,
  search = ''
): string | null {
  const key = hash.replace(/^#/, '').trim();
  const hit = LEGACY_ANCHORS[key];
  if (!hit) return null;
  const t = STARTUP_TABS.find((x) => x.id === hit.tab)!;
  const q = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `/startups/${startupId}${t.path}${q}${hit.anchor ? `#${hit.anchor}` : ''}`;
}
