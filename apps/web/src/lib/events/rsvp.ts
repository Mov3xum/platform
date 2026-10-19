import 'server-only';
import type PocketBase from 'pocketbase';
import { eventSeatsTaken, isRsvpToken, normalizeEventRsvpSettings, type EventRsvpSettings } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hashRsvpToken } from '@/lib/core/write/event-invitations';

/**
 * Löser en svarslänk (§ 53.5) till inbjudan + event. Den publika sidan och
 * svarsrouten har ingen session, så uppslaget går via superuser — därför
 * härleds tenant ur deltagarraden och eventet MÅSTE tillhöra samma tenant.
 * Token jämförs bara som SHA-256-hash; klartexten lagras aldrig.
 * Bär även svarssidans inställningar och gästens tidigare svar (§ 54.11).
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
    plus_ones?: number;
    diet?: string;
    custom_answer?: string;
    checked_in_at?: string;
  };
  event: {
    id: string;
    tenant: string;
    name?: string;
    starts_at?: string;
    ends_at?: string;
    location?: string;
    description?: string;
    rsvp_settings?: unknown;
  };
  settings: EventRsvpSettings;
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
        fields: 'id,tenant,event,stage,contact,name,invite_opened_at,plus_ones,diet,custom_answer,checked_in_at'
      });
    const event = await su.pb
      .collection('incubator_events')
      .getOne<ResolvedRsvp['event']>(signup.event, { fields: 'id,tenant,name,starts_at,ends_at,location,description,rsvp_settings' });
    if (!signup.tenant || event.tenant !== signup.tenant) return null;
    return { pb: su.pb, signup, event, settings: normalizeEventRsvpSettings(event.rsvp_settings) };
  } catch {
    return null;
  }
}

/** Platser som tas i eventet just nu (ja-svar och längre, inkl. medföljande). */
export async function loadSeatsTaken(pb: PocketBase, tenant: string, eventId: string): Promise<number> {
  try {
    const rows = await pb.collection('event_signups').getFullList<{ stage?: string; plus_ones?: number }>({
      filter: pb.filter('tenant = {:t} && event = {:e}', { t: tenant, e: eventId }),
      fields: 'id,stage,plus_ones'
    });
    return eventSeatsTaken(rows);
  } catch {
    return 0;
  }
}
