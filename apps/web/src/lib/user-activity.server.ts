import 'server-only';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { ACTIVITY_HEARTBEAT_MS, shouldTouchActivity } from '@/lib/users/activity';

/**
 * Användarlogg — serverns skrivvägar (CLAUDE.md § 36.4).
 *
 * `users.last_login_at`/`last_active_at`/`login_count` och kollektionen
 * `user_login_events` skrivs ENBART härifrån, med den cachade superusern:
 * fälten är låsta i users självservice-regel (migration 1700000206) och
 * `user_login_events.createRule` är null, så ingen användartoken kan skriva
 * om sin egen historik. Allt är fail-soft — ett hjärtslag eller en
 * inloggningsstämpel som inte kan skrivas får aldrig stoppa en inloggning
 * eller en sidladdning. Loggar bär status, aldrig id/e-post.
 */

/**
 * Per process: när vi senast SKREV ett hjärtslag för ett konto. Hindrar att
 * tio parallella requests efter ett långt uppehåll alla skriver samtidigt;
 * PB-raden är sanningen mellan containrar (`shouldTouchActivity` prövar den).
 */
const recentTouches = new Map<string, number>();
const MAX_TOUCH_MEMO = 5000;
let warnedMissingSuperuser = false;

function rememberTouch(userId: string, now: number): void {
  if (recentTouches.size >= MAX_TOUCH_MEMO) {
    for (const [id, at] of recentTouches) {
      if (now - at >= ACTIVITY_HEARTBEAT_MS) recentTouches.delete(id);
    }
    if (recentTouches.size >= MAX_TOUCH_MEMO) recentTouches.clear();
  }
  recentTouches.set(userId, now);
}

async function superuser() {
  const su = await getSuperuserPb();
  if (!su.ok) {
    if (!warnedMissingSuperuser) {
      warnedMissingSuperuser = true;
      console.warn('[user-activity] superuser unavailable — activity stamps are not written', {
        reason: su.reason
      });
    }
    return null;
  }
  return su.pb;
}

/**
 * Hjärtslag: uppdaterar `last_active_at` när den sparade stämpeln är äldre än
 * `ACTIVITY_HEARTBEAT_MS`. Anropas från sessionsläsningen med det värde
 * posten redan bar, så ett färskt konto kostar ingen extra skrivning.
 */
export async function touchUserActivity(userId: string, storedLastActiveAt: unknown): Promise<void> {
  if (!userId) return;
  const now = Date.now();
  if (!shouldTouchActivity(storedLastActiveAt, now)) return;
  const memo = recentTouches.get(userId);
  if (memo !== undefined && now - memo < ACTIVITY_HEARTBEAT_MS) return;
  rememberTouch(userId, now);

  const pb = await superuser();
  if (!pb) return;
  try {
    await pb.collection('users').update(userId, { last_active_at: new Date(now).toISOString() });
  } catch (err) {
    // 404 = kontot raderat mellan läsning och skrivning; övrigt loggas PII-fritt.
    const status = (err as { status?: number }).status ?? 0;
    if (status !== 404) console.warn('[user-activity] heartbeat failed', { status });
  }
}

/**
 * Inloggningsstämpel: `last_login_at`, `last_active_at`, `login_count` + en
 * rad i `user_login_events` (tenant, user, method — ingen IP, ingen user
 * agent). `login_count` läses färskt ur posten så två samtidiga inloggningar
 * inte tappar en räkning mer än i undantagsfall (ingen atomisk increment i PB).
 */
export async function recordUserLogin(args: {
  userId: string;
  tenant: string;
  method?: 'password';
}): Promise<void> {
  const { userId, tenant } = args;
  if (!userId || !tenant) return;
  const pb = await superuser();
  if (!pb) return;
  const nowIso = new Date().toISOString();
  rememberTouch(userId, Date.now());

  try {
    const current = await pb
      .collection('users')
      .getOne<{ login_count?: unknown }>(userId, { fields: 'id,login_count' });
    const count = typeof current.login_count === 'number' && Number.isFinite(current.login_count)
      ? current.login_count
      : 0;
    await pb.collection('users').update(userId, {
      last_login_at: nowIso,
      last_active_at: nowIso,
      login_count: count + 1
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    console.warn('[user-activity] login stamp failed', { status });
  }

  try {
    await pb.collection('user_login_events').create({
      tenant,
      user: userId,
      method: args.method ?? 'password'
    });
  } catch (err) {
    // 404 = kollektionen saknas (migration 1700000206 ej körd) — stämplarna
    // på users räcker tills dess; övrigt loggas PII-fritt.
    const status = (err as { status?: number }).status ?? 0;
    if (status !== 404) console.warn('[user-activity] login event failed', { status });
  }
}
