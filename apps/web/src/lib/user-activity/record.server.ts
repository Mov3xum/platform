import 'server-only';
import type PocketBase from 'pocketbase';
import {
  VISIT_THROTTLE_MS,
  applyLogin,
  applyVisit,
  normalizeUserActivity,
  type UserActivityStats
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Registrering av användaraktivitet (CLAUDE.md § 57) — ENDA skrivvägen till
 * `user_activity`. Kollektionen har create/update/delete = null, så allt
 * skrivs med den cachade superusern EFTER att anroparen verifierat sessionen
 * (inloggningsroutarna efter lyckad `authWithPassword`, besöks-routen efter
 * `getCurrentUser`). Användar-id och tenant kommer alltid från sessionen —
 * aldrig från klienten.
 *
 * Best-effort: ett fel här får ALDRIG påverka inloggningen eller sidan
 * (fail-soft, loggas PII-fritt). Skrivningar per användare serialiseras i
 * processen så två flikar inte skriver över varandras räknare; besök i samma
 * modul inom `VISIT_THROTTLE_MS` räknas inte igen.
 */

const COLLECTION = 'user_activity';

interface ActivityRow {
  id: string;
  user: string;
  tenant: string;
  first_login_at?: string;
  last_login_at?: string;
  login_count?: number;
  last_seen_at?: string;
  last_module?: string;
  modules?: unknown;
  active_days?: unknown;
}

const ROW_FIELDS = 'id,user,tenant,first_login_at,last_login_at,login_count,last_seen_at,last_module,modules,active_days';

/** Radens PB-fält → den rena modellen. Delas med läsvägen. */
export function statsFromRow(row: Partial<ActivityRow> | null | undefined): UserActivityStats {
  return normalizeUserActivity({
    first_login_at: row?.first_login_at || null,
    last_login_at: row?.last_login_at || null,
    login_count: row?.login_count ?? 0,
    last_seen_at: row?.last_seen_at || null,
    last_module: row?.last_module || null,
    modules: row?.modules,
    active_days: row?.active_days
  });
}

function rowPayload(stats: UserActivityStats, userId: string, tenant: string) {
  return {
    user: userId,
    tenant,
    first_login_at: stats.first_login_at ?? '',
    last_login_at: stats.last_login_at ?? '',
    login_count: stats.login_count,
    last_seen_at: stats.last_seen_at ?? '',
    last_module: stats.last_module ?? '',
    modules: stats.modules,
    active_days: stats.active_days
  };
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

// Serialisering per användare: nästa skrivning väntar på den pågående.
const chains = new Map<string, Promise<void>>();
// Senaste registrerade besök per användare+modul (throttle, processlokalt —
// en annan container räknar ett extra besök, vilket är ofarligt).
const lastVisit = new Map<string, number>();
const MAX_THROTTLE_KEYS = 20_000;

let missingWarned = false;

async function loadRow(pb: PocketBase, userId: string): Promise<ActivityRow | null> {
  try {
    return await pb
      .collection(COLLECTION)
      .getFirstListItem<ActivityRow>(pb.filter('user = {:u}', { u: userId }), { fields: ROW_FIELDS });
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

async function mutate(
  userId: string,
  tenant: string,
  update: (stats: UserActivityStats) => UserActivityStats
): Promise<void> {
  const su = await getSuperuserPb();
  if (!su.ok) {
    if (!missingWarned) {
      missingWarned = true;
      console.warn('[user-activity] superuser saknas — aktivitet registreras inte', { reason: su.reason });
    }
    return;
  }
  const pb = su.pb;
  let row: ActivityRow | null;
  try {
    row = await loadRow(pb, userId);
  } catch (err) {
    const status = statusOf(err);
    // 404 på kollektionen (migration 1700000209 ej körd) — logga en gång, tyst därefter.
    if (!missingWarned) {
      missingWarned = true;
      console.warn('[user-activity] kunde inte läsa user_activity', { status });
    }
    return;
  }
  // En rad som hör till en annan tenant än sessionen rörs aldrig (tenant byts
  // inte i praktiken; defense-in-depth mot en felkopplad post).
  if (row && row.tenant && row.tenant !== tenant) {
    console.warn('[user-activity] tenant-mismatch på aktivitetsrad', { status: 'skipped' });
    return;
  }
  const next = update(statsFromRow(row));
  const payload = rowPayload(next, userId, tenant);
  try {
    if (row) {
      await pb.collection(COLLECTION).update(row.id, payload, { fields: 'id' });
    } else {
      try {
        await pb.collection(COLLECTION).create(payload, { fields: 'id' });
      } catch (err) {
        // Unikt index på user: en parallell skrivning hann först → uppdatera i stället.
        if (statusOf(err) !== 400) throw err;
        const again = await loadRow(pb, userId);
        if (!again) throw err;
        await pb.collection(COLLECTION).update(again.id, rowPayload(update(statsFromRow(again)), userId, tenant), {
          fields: 'id'
        });
      }
    }
  } catch (err) {
    console.warn('[user-activity] kunde inte skriva aktivitet', { status: statusOf(err) });
  }
}

function enqueue(userId: string, work: () => Promise<void>): Promise<void> {
  const prev = chains.get(userId) ?? Promise.resolve();
  const next = prev.then(work, work).catch(() => undefined);
  chains.set(userId, next);
  void next.finally(() => {
    if (chains.get(userId) === next) chains.delete(userId);
  });
  return next;
}

/** Lyckad inloggning. Anropas EFTER att PocketBase autentiserat användaren. */
export function recordLogin(userId: string, tenant: string): Promise<void> {
  if (!userId || !tenant) return Promise.resolve();
  const now = new Date();
  return enqueue(userId, () => mutate(userId, tenant, (s) => applyLogin(s, now)));
}

/**
 * Ett besök i en modul. `moduleId` är redan validerat mot modulregistret av
 * routen. Returnerar `false` när besöket föll under throttle-fönstret.
 */
export function recordVisit(userId: string, tenant: string, moduleId: string): Promise<boolean> {
  if (!userId || !tenant || !moduleId) return Promise.resolve(false);
  const key = `${userId}:${moduleId}`;
  const nowMs = Date.now();
  const prev = lastVisit.get(key);
  if (prev !== undefined && nowMs - prev < VISIT_THROTTLE_MS) return Promise.resolve(false);
  if (lastVisit.size >= MAX_THROTTLE_KEYS) lastVisit.clear();
  lastVisit.set(key, nowMs);
  const now = new Date(nowMs);
  return enqueue(userId, () => mutate(userId, tenant, (s) => applyVisit(s, moduleId, now))).then(() => true);
}
