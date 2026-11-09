// CLAUDE.md § 57 — Användaraktivitet: inloggningar och vilka delar av
// plattformen en person faktiskt använder, som stöd för att hjälpa nya
// användare igång. REN modul (ingen IO, ingen React) — enhetstestad.
//
// Dataminimering (GDPR § 5): aggregatet är per MODUL (sida i sidmenyn), aldrig
// per sökväg, post eller bolag. Det som lagras är tidpunkter och räknare —
// ingen IP, ingen user agent, inget innehåll. Aktiva dagar hålls i ett
// rullande fönster (`ACTIVE_DAYS_WINDOW`) och modulrader som inte besökts på
// `MODULE_STAT_RETENTION_DAYS` rensas vid nästa skrivning.

import { stockholmDateKey, stockholmDayDiff } from './event-time';
import { MODULE_ID_ALIASES } from './module-access';

export interface UserModuleStat {
  /** Antal registrerade besök (ett per modul och throttle-fönster, inte per sidvisning). */
  visits: number;
  first_at: string;
  last_at: string;
}

export interface UserActivityStats {
  first_login_at: string | null;
  last_login_at: string | null;
  login_count: number;
  last_seen_at: string | null;
  last_module: string | null;
  modules: Record<string, UserModuleStat>;
  /** Svenska kalenderdatum (YYYY-MM-DD) med aktivitet, stigande, max `ACTIVE_DAYS_WINDOW` dagar bakåt. */
  active_days: string[];
}

/** Hur många dagar bakåt aktiva dagar sparas. */
export const ACTIVE_DAYS_WINDOW = 90;
/** En modulrad som inte besökts på så här många dagar rensas vid nästa skrivning. */
export const MODULE_STAT_RETENTION_DAYS = 365;
/** Utan aktivitet så här länge räknas kontot som vilande. */
export const DORMANT_AFTER_DAYS = 30;
/** Ett nytt besök i samma modul räknas först efter så här lång tid (servern). */
export const VISIT_THROTTLE_MS = 60_000;
/** Tak på antal modulrader per användare (skydd mot påhittade modul-id:n — som ändå valideras). */
export const MAX_MODULE_STATS = 80;

export function emptyUserActivity(): UserActivityStats {
  return {
    first_login_at: null,
    last_login_at: null,
    login_count: 0,
    last_seen_at: null,
    last_module: null,
    modules: {},
    active_days: []
  };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function nonNegInt(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const MODULE_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function isValidModuleId(value: unknown): value is string {
  return typeof value === 'string' && MODULE_ID_RE.test(value);
}

/**
 * Tolerant normalisering av en lagrad/okänd rad — fel form blir tomt, aldrig
 * ett undantag (samma princip som `normalizeNotificationPreferences`).
 */
export function normalizeUserActivity(raw: unknown): UserActivityStats {
  const out = emptyUserActivity();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  out.first_login_at = isoOrNull(r.first_login_at);
  out.last_login_at = isoOrNull(r.last_login_at);
  out.login_count = nonNegInt(r.login_count);
  out.last_seen_at = isoOrNull(r.last_seen_at);
  out.last_module = isValidModuleId(r.last_module) ? r.last_module : null;

  const modules = r.modules;
  if (modules && typeof modules === 'object' && !Array.isArray(modules)) {
    for (const [id, stat] of Object.entries(modules as Record<string, unknown>)) {
      if (!isValidModuleId(id) || !stat || typeof stat !== 'object') continue;
      const s = stat as Record<string, unknown>;
      const last = isoOrNull(s.last_at);
      if (!last) continue;
      out.modules[id] = {
        visits: Math.max(1, nonNegInt(s.visits)),
        first_at: isoOrNull(s.first_at) ?? last,
        last_at: last
      };
      if (Object.keys(out.modules).length >= MAX_MODULE_STATS) break;
    }
  }

  const days = Array.isArray(r.active_days) ? r.active_days : [];
  const seen = new Set<string>();
  for (const d of days) {
    if (typeof d === 'string' && DAY_RE.test(d)) seen.add(d);
  }
  out.active_days = [...seen].sort();
  return out;
}

/**
 * Vilken modul en sökväg i appen hör till — längsta matchande `route` vinner
 * (`/installningar/anvandare` ⇒ `anvandare`, inte `installningar`), alias-id:n
 * (`toolbox` ⇒ `agenter`) slås ihop med sitt mål. Sökvägar utanför modulerna
 * (t.ex. `/konto`, `/login`) ger `null` och registreras inte.
 */
export function moduleIdForPath(
  pathname: string,
  modules: readonly { id: string; route: string }[]
): string | null {
  const path = (pathname.split('?')[0] ?? '').split('#')[0] ?? '';
  if (!path.startsWith('/')) return null;
  let best: { id: string; len: number } | null = null;
  for (const m of modules) {
    const route = m.route.replace(/\/+$/, '');
    if (route === '' || route === '/') continue;
    if (path !== route && !path.startsWith(`${route}/`)) continue;
    if (!best || route.length > best.len) best = { id: m.id, len: route.length };
  }
  if (!best) return null;
  return MODULE_ID_ALIASES[best.id] ?? best.id;
}

function withActiveDay(days: string[], now: Date): string[] {
  const key = stockholmDateKey(now);
  const cutoff = stockholmDateKey(new Date(now.getTime() - ACTIVE_DAYS_WINDOW * 86_400_000));
  const kept = days.filter((d) => d >= cutoff);
  if (!kept.includes(key)) kept.push(key);
  return kept.sort();
}

function pruneModules(modules: Record<string, UserModuleStat>, now: Date): Record<string, UserModuleStat> {
  const cutoffMs = now.getTime() - MODULE_STAT_RETENTION_DAYS * 86_400_000;
  const out: Record<string, UserModuleStat> = {};
  for (const [id, s] of Object.entries(modules)) {
    if (Date.parse(s.last_at) >= cutoffMs) out[id] = s;
  }
  return out;
}

/** Ett besök i en modul. Returnerar en NY post (muterar inte). */
export function applyVisit(stats: UserActivityStats, moduleId: string, now: Date): UserActivityStats {
  const iso = now.toISOString();
  const modules = pruneModules(stats.modules, now);
  const prev = modules[moduleId];
  modules[moduleId] = prev
    ? { visits: prev.visits + 1, first_at: prev.first_at, last_at: iso }
    : { visits: 1, first_at: iso, last_at: iso };
  return {
    ...stats,
    last_seen_at: iso,
    last_module: moduleId,
    modules,
    active_days: withActiveDay(stats.active_days, now)
  };
}

/** En lyckad inloggning. Returnerar en NY post (muterar inte). */
export function applyLogin(stats: UserActivityStats, now: Date): UserActivityStats {
  const iso = now.toISOString();
  return {
    ...stats,
    first_login_at: stats.first_login_at ?? iso,
    last_login_at: iso,
    login_count: stats.login_count + 1,
    last_seen_at: iso,
    modules: pruneModules(stats.modules, now),
    active_days: withActiveDay(stats.active_days, now)
  };
}

export type UserActivityStatus = 'never' | 'active' | 'dormant';

/** `never` = aldrig inloggad, `dormant` = inget på `DORMANT_AFTER_DAYS` dagar, annars `active`. */
export function activityStatus(stats: UserActivityStats, now: Date): UserActivityStatus {
  if (!stats.last_login_at && !stats.last_seen_at) return 'never';
  const seen = stats.last_seen_at ?? stats.last_login_at!;
  const days = stockholmDayDiff(new Date(seen), now);
  return days > DORMANT_AFTER_DAYS ? 'dormant' : 'active';
}

export const USER_ACTIVITY_STATUS_LABEL: Record<UserActivityStatus, string> = {
  never: 'Aldrig inloggad',
  active: 'Aktiv',
  dormant: 'Vilande'
};

/** Antal aktiva dagar inom de senaste `days` dagarna (inklusive idag). */
export function activeDaysWithin(stats: UserActivityStats, now: Date, days = 30): number {
  const cutoff = stockholmDateKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  return stats.active_days.filter((d) => d >= cutoff).length;
}

/** Modulerna sorterade efter antal besök (flest först), därefter senast besökt. */
export function topModules(stats: UserActivityStats, limit = 12): Array<{ id: string } & UserModuleStat> {
  return Object.entries(stats.modules)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.visits - a.visits || b.last_at.localeCompare(a.last_at))
    .slice(0, limit);
}

/**
 * Moduler som är ibockade för personen men aldrig öppnats — det viktigaste
 * underlaget för att hjälpa någon igång. `candidateIds` är de id:n som visas
 * i personens sidmeny (alias/dolda id:n hoppar anroparen över).
 */
export function neverOpenedModules(candidateIds: readonly string[], stats: UserActivityStats): string[] {
  return candidateIds.filter((id) => !(id in stats.modules));
}

/** Relativ tid på svenska ("för 3 h sedan", "igår"), annars datum. */
export function formatRelativeTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return 'aldrig';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'okänt';
  const diffMin = Math.round((now.getTime() - ms) / 60_000);
  if (diffMin < 1) return 'just nu';
  if (diffMin < 60) return `för ${diffMin} min sedan`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `för ${diffH} h sedan`;
  const days = stockholmDayDiff(new Date(ms), now);
  if (days <= 1) return 'igår';
  if (days < 7) return `för ${days} dagar sedan`;
  if (days < 30) return `för ${Math.round(days / 7)} veckor sedan`;
  if (days < 365) return `för ${Math.max(1, Math.round(days / 30))} månader sedan`;
  return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}
