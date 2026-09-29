import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { collectSurveyRecipients } from '@platform/shared';

/**
 * Antal deltagare med giltig e-post för ett event (§ 47.5). Läser
 * `event_signups` med användarens token (RLS) och superuser-fallback vid
 * PB v0.23.4:s tysta nekande (§ 21.3), tenant-filtrerat i båda fallen.
 * Returnerar bara ett TAL — adresserna lämnar aldrig servern.
 */
export async function countSurveyRecipients(
  pb: PocketBase,
  tenant: string,
  eventId: string
): Promise<number> {
  const read = (c: PocketBase) =>
    c.collection('event_signups').getFullList<{ email?: string }>({
      filter: c.filter('event = {:e} && tenant = {:t}', { e: eventId, t: tenant }),
      fields: 'id,email'
    });
  let rows: { email?: string }[] = [];
  try {
    rows = await read(pb);
  } catch {
    rows = [];
  }
  if (rows.length === 0) {
    const su = await getSuperuserPb();
    if (su.ok) {
      try {
        rows = await read(su.pb);
      } catch {
        rows = [];
      }
    }
  }
  return collectSurveyRecipients(rows).length;
}
