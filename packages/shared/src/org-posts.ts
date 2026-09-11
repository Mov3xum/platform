// Hemmaplan — organisationens anslagstavla (CLAUDE.md § 37).
//
// Ren, testbar domänlogik för inlägg på startsidan: inläggstyper, validering,
// synlighetsregler (publicerat / utgånget / målgrupp) och sortering (fästa
// först). Delas av server-actions, sidan och (framtida) chatt-verktyg så att
// reglerna aldrig divergerar. Inga beroenden, ingen PII.

import type { Role } from './index';

/** Inläggstyper — fast vokabulär (samma mönster som file-topics/competences). */
export const ORG_POST_KINDS = ['news', 'notice', 'instruction', 'celebration', 'training'] as const;
export type OrgPostKind = (typeof ORG_POST_KINDS)[number];

export const ORG_POST_KIND_LABELS: Record<OrgPostKind, string> = {
  news: 'Nyhet',
  notice: 'Info',
  instruction: 'Instruktion',
  celebration: 'Firande',
  training: 'Internutbildning'
};

/** Kort hjälptext per typ (visas i redigeraren). */
export const ORG_POST_KIND_HINTS: Record<OrgPostKind, string> = {
  news: 'Något som hänt — i portföljen, i organisationen eller i omvärlden.',
  notice: 'Praktisk information till kollegorna: lokaler, system, deadlines.',
  instruction: 'Så gör vi: rutiner och checklistor som ska vara lätta att hitta.',
  celebration: 'Något att fira — en milstolpe, en investering, ett nytt bolag.',
  training:
    'Internutbildning för kollegorna: ett pass, en guide eller ett material att gå igenom. Administreras även via chatten.'
};

/**
 * Inläggstyper som visas under respektive flik på Hemmaplan. `board` =
 * anslagstavlan (nyheter/info/firanden), `instruction` = "Så gör vi",
 * `training` = "Internutbildningar". En typ hör alltid till exakt en flik.
 */
export type OrgPostTab = 'board' | 'instruction' | 'training';

export function orgPostTabFor(kind: OrgPostKind): OrgPostTab {
  if (kind === 'instruction') return 'instruction';
  if (kind === 'training') return 'training';
  return 'board';
}

/** Query-parametern som pekar ut fliken på Hemmaplan (`/hem?flik=…`). */
export const HOME_TAB_PARAM = 'flik';

/** URL-slug per flik — delas av server (page/agent-log) och klient (flikarna). */
export const HOME_TAB_SLUGS: Record<OrgPostTab, string> = {
  board: 'anslagstavla',
  instruction: 'sa-gor-vi',
  training: 'internutbildningar'
};

/** Slug → flik; okänd/saknad slug ger anslagstavlan. Ren, får anropas från servern. */
export function homeTabFromSlug(slug: string | undefined): OrgPostTab {
  const hit = (Object.keys(HOME_TAB_SLUGS) as OrgPostTab[]).find((k) => HOME_TAB_SLUGS[k] === slug);
  return hit ?? 'board';
}

/** Intern länk till Hemmaplan med rätt flik öppen (anslagstavlan = bara `/hem`). */
export function homeTabHref(tab: OrgPostTab): string {
  return tab === 'board' ? '/hem' : `/hem?${HOME_TAB_PARAM}=${HOME_TAB_SLUGS[tab]}`;
}

/**
 * Målgrupp. `staff` = Movexum-personal + observer (default);
 * `all` = även bolagsmedlemmar (visas på "Min översikt" för medlemmar).
 */
export const ORG_POST_AUDIENCES = ['staff', 'all'] as const;
export type OrgPostAudience = (typeof ORG_POST_AUDIENCES)[number];

export const ORG_POST_AUDIENCE_LABELS: Record<OrgPostAudience, string> = {
  staff: 'Movexum-teamet',
  all: 'Hela organisationen (även bolagen)'
};

export const ORG_POST_TITLE_MAX = 160;
export const ORG_POST_BODY_MAX = 20_000;
export const ORG_POST_LINK_MAX = 500;

/** Roller som får skriva inlägg. Speglas i PB-reglerna (migration 1700000144). */
export const ORG_POST_AUTHOR_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
/** Roller som får redigera/radera ANDRAS inlägg (utöver författaren själv). */
export const ORG_POST_MODERATOR_ROLES: Role[] = ['admin', 'incubator_lead'];

export interface OrgPost {
  id: string;
  tenant: string;
  author: string;
  /** Författarens visningsnamn, upplöst av anroparen (aldrig e-post). */
  author_name?: string | null;
  title: string;
  /** Markdown (renderas via safe-html). */
  body: string;
  kind: OrgPostKind;
  audience: OrgPostAudience;
  pinned: boolean;
  /** ISO-datum. Tomt = publicerad direkt. */
  published_at?: string | null;
  /** ISO-datum. Tomt = utgår aldrig. */
  expires_at?: string | null;
  /** Valfri länk (intern sökväg eller https-URL). */
  link_url?: string | null;
  created: string;
  updated?: string;
}

export interface OrgPostInput {
  title: string;
  body: string;
  kind: OrgPostKind;
  audience: OrgPostAudience;
  pinned: boolean;
  published_at?: string | null;
  expires_at?: string | null;
  link_url?: string | null;
}

export type OrgPostValidation =
  | { ok: true; value: OrgPostInput }
  | { ok: false; error: string };

export function isOrgPostKind(value: unknown): value is OrgPostKind {
  return typeof value === 'string' && (ORG_POST_KINDS as readonly string[]).includes(value);
}

export function isOrgPostAudience(value: unknown): value is OrgPostAudience {
  return typeof value === 'string' && (ORG_POST_AUDIENCES as readonly string[]).includes(value);
}

function normalizeDate(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return d.toISOString();
}

/**
 * Länkar får vara interna sökvägar ("/startups/abc") eller https-URL:er.
 * Aldrig `javascript:`/`data:` — inlägget renderas som <a href>.
 */
export function isSafeOrgPostLink(value: string): boolean {
  if (!value) return true;
  if (value.length > ORG_POST_LINK_MAX) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  return /^https:\/\/[^\s]+$/i.test(value);
}

/**
 * Validerar och normaliserar ett inlägg från formulär/verktyg. Trimmar,
 * kollar längder/enum-värden och att utgångsdatum ligger efter publicering.
 */
export function validateOrgPostInput(raw: Record<string, unknown>): OrgPostValidation {
  const title = String(raw.title ?? '').trim();
  if (!title) return { ok: false, error: 'Rubrik saknas.' };
  if (title.length > ORG_POST_TITLE_MAX) {
    return { ok: false, error: `Rubriken får vara högst ${ORG_POST_TITLE_MAX} tecken.` };
  }
  const body = String(raw.body ?? '').replace(/\r\n/g, '\n').trim();
  if (body.length > ORG_POST_BODY_MAX) {
    return { ok: false, error: `Texten får vara högst ${ORG_POST_BODY_MAX} tecken.` };
  }
  const kind = raw.kind ?? 'news';
  if (!isOrgPostKind(kind)) return { ok: false, error: 'Okänd inläggstyp.' };
  const audience = raw.audience ?? 'staff';
  if (!isOrgPostAudience(audience)) return { ok: false, error: 'Okänd målgrupp.' };

  const published = normalizeDate(raw.published_at);
  if (published === 'invalid') return { ok: false, error: 'Ogiltigt publiceringsdatum.' };
  const expires = normalizeDate(raw.expires_at);
  if (expires === 'invalid') return { ok: false, error: 'Ogiltigt utgångsdatum.' };
  if (published && expires && new Date(expires).getTime() <= new Date(published).getTime()) {
    return { ok: false, error: 'Utgångsdatumet måste ligga efter publiceringen.' };
  }

  const link = String(raw.link_url ?? '').trim();
  if (!isSafeOrgPostLink(link)) {
    return { ok: false, error: 'Länken måste vara en intern sökväg (/…) eller en https-adress.' };
  }

  const pinned = raw.pinned === true || raw.pinned === 'true' || raw.pinned === 'on' || raw.pinned === 1;

  return {
    ok: true,
    value: {
      title,
      body,
      kind,
      audience,
      pinned,
      published_at: published,
      expires_at: expires,
      link_url: link || null
    }
  };
}

/** Publicerad (eller utan schemalagd publicering) och inte utgången. */
export function isOrgPostLive(
  post: Pick<OrgPost, 'published_at' | 'expires_at'>,
  now: Date = new Date()
): boolean {
  const t = now.getTime();
  if (post.published_at) {
    const p = new Date(post.published_at).getTime();
    if (!Number.isNaN(p) && p > t) return false;
  }
  if (post.expires_at) {
    const e = new Date(post.expires_at).getTime();
    if (!Number.isNaN(e) && e <= t) return false;
  }
  return true;
}

/** Schemalagd men ännu inte publicerad. */
export function isOrgPostScheduled(post: Pick<OrgPost, 'published_at'>, now: Date = new Date()): boolean {
  if (!post.published_at) return false;
  const p = new Date(post.published_at).getTime();
  return !Number.isNaN(p) && p > now.getTime();
}

/** Utgången (visas bara i redigerarens arkiv). */
export function isOrgPostExpired(post: Pick<OrgPost, 'expires_at'>, now: Date = new Date()): boolean {
  if (!post.expires_at) return false;
  const e = new Date(post.expires_at).getTime();
  return !Number.isNaN(e) && e <= now.getTime();
}

/**
 * Får rollerna se inlägget? Staff/observer ser allt i tenanten; en ren
 * bolagsmedlem ser bara `audience = 'all'`. UI-kurering — PB-reglerna är
 * säkerhetsgränsen (§ 21).
 */
export function canRolesSeeOrgPost(roles: Role[] | undefined, post: Pick<OrgPost, 'audience'>): boolean {
  if (post.audience === 'all') return true;
  const staffOrObserver: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];
  return (roles ?? []).some((r) => staffOrObserver.includes(r));
}

export function canRolesAuthorOrgPost(roles: Role[] | undefined): boolean {
  return (roles ?? []).some((r) => ORG_POST_AUTHOR_ROLES.includes(r));
}

/** Författaren själv, eller en moderator, får ändra/radera. */
export function canEditOrgPost(
  user: { id: string; roles: Role[] | undefined },
  post: Pick<OrgPost, 'author'>
): boolean {
  if (!canRolesAuthorOrgPost(user.roles)) return false;
  if (post.author === user.id) return true;
  return (user.roles ?? []).some((r) => ORG_POST_MODERATOR_ROLES.includes(r));
}

function effectiveDate(post: Pick<OrgPost, 'published_at' | 'created'>): number {
  const p = post.published_at ? new Date(post.published_at).getTime() : Number.NaN;
  if (!Number.isNaN(p)) return p;
  const c = new Date(post.created).getTime();
  return Number.isNaN(c) ? 0 : c;
}

/** Fästa först, därefter nyast (publiceringsdatum, annars skapad). */
export function sortOrgPosts<T extends Pick<OrgPost, 'pinned' | 'published_at' | 'created'>>(
  posts: readonly T[]
): T[] {
  return [...posts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return effectiveDate(b) - effectiveDate(a);
  });
}

/**
 * Det som ska visas på startsidan: levande inlägg som rollerna får se,
 * sorterade. Instruktioner ("Så gör vi") lyfts ut separat av vyn via `kind`.
 */
export function selectLiveOrgPosts<T extends OrgPost>(
  posts: readonly T[],
  roles: Role[] | undefined,
  now: Date = new Date()
): T[] {
  return sortOrgPosts(posts.filter((p) => isOrgPostLive(p, now) && canRolesSeeOrgPost(roles, p)));
}

/** Kort utdrag av brödtexten för listor (markdown-markörer strippade). */
export function orgPostExcerpt(body: string, max = 180): string {
  const plain = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).trimEnd()}…`;
}
