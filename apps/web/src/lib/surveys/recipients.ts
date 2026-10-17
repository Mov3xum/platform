import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { collectSurveyRecipients, isAttendedStage, isInviteStage } from '@platform/shared';

export interface SurveyRecipientCounts {
  /** Anmälda (alla steg utom inbjuden/avböjt) med giltig e-post. */
  registered: number;
  /** Närvarande (eller längre i tratten) med giltig e-post — de som får enkäten. */
  attended: number;
}

/**
 * Antal deltagare med giltig e-post för ett event (§ 47.5, § 53.1). Läser
 * `event_signups` med användarens token (RLS) och superuser-fallback vid
 * PB v0.23.4:s tysta nekande (§ 21.3), tenant-filtrerat i båda fallen.
 * Returnerar bara TAL — adresserna lämnar aldrig servern.
 */
export async function countSurveyRecipients(
  pb: PocketBase,
  tenant: string,
  eventId: string
): Promise<SurveyRecipientCounts> {
  const read = (c: PocketBase) =>
    c.collection('event_signups').getFullList<{ email?: string; stage?: string }>({
      filter: c.filter('event = {:e} && tenant = {:t}', { e: eventId, t: tenant }),
      fields: 'id,email,stage'
    });
  let rows: { email?: string; stage?: string }[] = [];
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
  return {
    registered: collectSurveyRecipients(rows.filter((r) => !isInviteStage(r.stage))).length,
    attended: collectSurveyRecipients(rows.filter((r) => isAttendedStage(r.stage))).length
  };
}
