/**
 * Howspace (CLAUDE.md § 59) — REN domänlogik för Howspace-sidan och
 * providern: tolerant tolkning av leverantörens svar, säkra länkar och
 * sammanslagning av synkade poster till det som visas på `/howspace`.
 * Ingen IO, inget `server-only` — enhetstestad i `howspace.test.ts`.
 *
 * Howspaces Partner API har ingen publik dokumentation (API-URL och schema
 * ligger i kontot), så fältnamnen läses ur kandidatlistor och allt okänt
 * noteras PII-fritt — samma princip som bolagsregister-providrarna (§ 11.8).
 * Deltagardata reduceras ALLTID till räknare: inga namn, inga e-postadresser.
 */

/** Tillåtna värdar för API- och app-adresser (https + allowlist, § 10.3). */
export const HOWSPACE_ALLOWED_HOSTS = ['howspace.com'];
export const HOWSPACE_DEFAULT_API_BASE_URL = 'https://api.howspace.com/v1';
export const HOWSPACE_DEFAULT_APP_URL = 'https://app.howspace.com';

export const HOWSPACE_RECORD_TYPES = {
  workspace: 'workspace',
  workspaceStats: 'workspace_stats'
} as const;

export interface HowspaceWorkspaceData {
  id: string;
  name: string;
  description: string;
  status: string;
  participantCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
}

export interface HowspaceStatsData {
  total: number | null;
  active: number | null;
}

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickString(obj: Dict, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickNumber(obj: Dict, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function pickDate(obj: Dict, keys: string[]): string | null {
  const raw = pickString(obj, keys);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Plockar listan ur ett svar som kan vara en ren array eller ett kuvert
 * (`workspaces`, `data`, `items`, `results`, ev. ett steg ned under `data`).
 */
export function extractHowspaceList(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!isDict(response)) return [];
  for (const key of ['workspaces', 'data', 'items', 'results']) {
    const v = response[key];
    if (Array.isArray(v)) return v;
    if (isDict(v)) {
      for (const inner of ['workspaces', 'items', 'results']) {
        if (Array.isArray(v[inner])) return v[inner] as unknown[];
      }
    }
  }
  return [];
}

/** Tolkar en workspace-post tolerant; `null` när ingen identitet finns. */
export function parseHowspaceWorkspace(raw: unknown): HowspaceWorkspaceData | null {
  if (!isDict(raw)) return null;
  const id = pickString(raw, ['id', 'workspaceId', 'workspace_id', 'uuid', 'slug']);
  if (!id) return null;
  const name = pickString(raw, ['name', 'title', 'displayName']) ?? `Workspace ${id}`;
  const description = pickString(raw, ['description', 'summary', 'tagline']) ?? '';
  const status = pickString(raw, ['status', 'state']) ?? '';
  const participantCount = pickNumber(raw, [
    'participantCount',
    'participant_count',
    'participantsCount',
    'participants',
    'memberCount',
    'member_count',
    'members'
  ]);
  return {
    id,
    name: name.slice(0, 300),
    description: description.slice(0, 1000),
    status: status.slice(0, 60),
    participantCount,
    createdAt: pickDate(raw, ['createdAt', 'created_at', 'created']),
    updatedAt: pickDate(raw, ['updatedAt', 'updated_at', 'modified', 'modifiedAt']),
    url: safeHowspaceUrl(pickString(raw, ['url', 'link', 'href', 'webUrl']))
  };
}

/** Tolkar deltagarstatistik; bara räknare, aldrig personer. */
export function parseHowspaceStats(raw: unknown): HowspaceStatsData {
  if (!isDict(raw)) return { total: null, active: null };
  const source = isDict(raw.data) ? (raw.data as Dict) : raw;
  return {
    total: pickNumber(source, ['total', 'totalParticipants', 'total_participants', 'count', 'participants']),
    active: pickNumber(source, ['active', 'activeParticipants', 'active_participants', 'activeCount'])
  };
}

/** Bara https-länkar till en Howspace-värd släpps igenom — annars `null`. */
export function safeHowspaceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const ok = HOWSPACE_ALLOWED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
  return ok ? url.toString() : null;
}

/** Länk till ett workspace: leverantörens URL om den är säker, annars appens standardväg. */
export function howspaceWorkspaceUrl(workspaceId: string, providedUrl: string | null, appUrl: string): string {
  return providedUrl ?? `${appUrl.replace(/\/$/, '')}/workspace/${encodeURIComponent(workspaceId)}`;
}

/**
 * En synkad post som `/howspace` läser ur `integration_records`
 * (bara fälten sidan behöver).
 */
export interface HowspaceSyncedRecord {
  record_type: string;
  external_id: string;
  title?: string;
  summary?: string;
  url?: string;
  occurred_at?: string;
  synced_at?: string;
  payload?: unknown;
}

export interface HowspaceWorkspaceView {
  id: string;
  name: string;
  summary: string;
  status: string;
  url: string | null;
  participantCount: number | null;
  activeCount: number | null;
  updatedAt: string | null;
  statsAt: string | null;
}

/**
 * Slår ihop `workspace`- och `workspace_stats`-poster till en rad per
 * workspace, sorterad på namn. Stats-raden heter `<id>:stats`.
 */
export function buildHowspaceWorkspaceViews(records: HowspaceSyncedRecord[]): HowspaceWorkspaceView[] {
  const stats = new Map<string, { total: number | null; active: number | null; at: string | null }>();
  for (const r of records) {
    if (r.record_type !== HOWSPACE_RECORD_TYPES.workspaceStats) continue;
    const id = r.external_id.replace(/:stats$/, '');
    const payload = isDict(r.payload) ? r.payload : {};
    stats.set(id, {
      total: pickNumber(payload, ['total']),
      active: pickNumber(payload, ['active']),
      at: r.occurred_at || r.synced_at || null
    });
  }
  const out: HowspaceWorkspaceView[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (r.record_type !== HOWSPACE_RECORD_TYPES.workspace) continue;
    if (seen.has(r.external_id)) continue;
    seen.add(r.external_id);
    const payload = isDict(r.payload) ? r.payload : {};
    const s = stats.get(r.external_id);
    out.push({
      id: r.external_id,
      name: (r.title || '').trim() || `Workspace ${r.external_id}`,
      summary: (r.summary || '').trim(),
      status: pickString(payload, ['status']) ?? '',
      url: safeHowspaceUrl(r.url),
      participantCount: s?.total ?? pickNumber(payload, ['participantCount']),
      activeCount: s?.active ?? null,
      updatedAt: r.occurred_at || null,
      statsAt: s?.at ?? null
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

/** Ett läsbart statusord för chip:en (okänd status visas som den är). */
export function howspaceStatusLabel(status: string): { label: string; tone: 'green' | 'yellow' | 'archive' | 'default' } {
  const s = status.toLowerCase();
  if (!s) return { label: '', tone: 'default' };
  if (['active', 'open', 'published', 'live'].includes(s)) return { label: 'Aktiv', tone: 'green' };
  if (['draft', 'pending', 'upcoming'].includes(s)) return { label: 'Utkast', tone: 'yellow' };
  if (['archived', 'closed', 'ended', 'inactive'].includes(s)) return { label: 'Arkiverad', tone: 'archive' };
  return { label: status, tone: 'default' };
}
