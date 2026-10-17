import 'server-only';
import type PocketBase from 'pocketbase';
import { isRsvpToken } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hashRsvpToken } from '@/lib/core/write/event-invitations';

/**
 * Löser en svarslänk (§ 53.5) till inbjudan + event. Den publika sidan och
 * svarsrouten har ingen session, så uppslaget går via superuser — därför
 * härleds tenant ur deltagarraden och eventet MÅSTE tillhöra samma tenant.
 * Token jämförs bara som SHA-256-hash; klartexten lagras aldrig.
 */
export interface ResolvedRsvp {
  pb: PocketBase;
  signup: {
    id: string;
    tenant: string;
    event: string;
    stage: string;
    contact?: string;
    name?: string;
    invite_opened_at?: string;
  };
  event: { id: string; tenant: string; name?: string; starts_at?: string; ends_at?: string; location?: string };
}

export async function resolveRsvp(token: unknown): Promise<ResolvedRsvp | null> {
  if (!isRsvpToken(token)) return null;
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[rsvp] superuser unavailable');
    return null;
  }
  try {
    const signup = await su.pb
      .collection('event_signups')
      .getFirstListItem<ResolvedRsvp['signup']>(su.pb.filter('rsvp_token_hash = {:h}', { h: hashRsvpToken(token) }), {
        fields: 'id,tenant,event,stage,contact,name,invite_opened_at'
      });
    const event = await su.pb
      .collection('incubator_events')
      .getOne<ResolvedRsvp['event']>(signup.event, { fields: 'id,tenant,name,starts_at,ends_at,location' });
    if (!signup.tenant || event.tenant !== signup.tenant) return null;
    return { pb: su.pb, signup, event };
  } catch {
    return null;
  }
}
