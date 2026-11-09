import 'server-only';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { STUDENT_PROFILES } from './data';

/** Obekräftade registreringar rensas efter 7 dagar; samtyckta profiler vid `expires_at`. */
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 100;

/**
 * Lagringsminimering (GDPR art. 5.1 e, § 54): tar bort studentprofiler vars
 * samtycke gått ut och registreringar som aldrig bekräftades. Körs lazy när
 * Movexum öppnar studentlistan — en profil som gallrats syns alltså aldrig
 * i listan. Intressen kaskadraderas. Loggen bär bara antal.
 */
export async function pruneExpiredStudents(tenant: string): Promise<{ removed: number }> {
  const su = await getSuperuserPb();
  if (!su.ok) return { removed: 0 };
  const now = new Date();
  const pendingBefore = new Date(now.getTime() - PENDING_TTL_MS).toISOString().replace('T', ' ');
  const nowPb = now.toISOString().replace('T', ' ');
  let removed = 0;
  try {
    const res = await su.pb.collection(STUDENT_PROFILES).getList<{ id: string; tenant?: string }>(1, MAX_PER_RUN, {
      filter: su.pb.filter('tenant = {:t} && (expires_at < {:now} || (status = "pending" && created < {:pend}))', {
        t: tenant,
        now: nowPb,
        pend: pendingBefore
      }),
      fields: 'id,tenant'
    });
    for (const row of res.items) {
      if (String(row.tenant) !== tenant) continue;
      try {
        await su.pb.collection(STUDENT_PROFILES).delete(row.id);
        removed++;
      } catch {
        /* nästa */
      }
    }
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) console.error('[talent] prune failed', { status });
  }
  if (removed > 0) console.info('[talent] pruned expired student profiles', { removed });
  return { removed };
}
