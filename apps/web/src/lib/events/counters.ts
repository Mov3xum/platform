import 'server-only';
import type PocketBase from 'pocketbase';
import { eventSignupCounters } from '@platform/shared';

/**
 * Räknar om eventets denormaliserade deltagarräknare ur deltagarlistan
 * (§ 53.1). Delas av eventsidans actions, inbjudningarna och den publika
 * svarsvägen (som kör som superuser — därför tenant-filtret). Fail-soft:
 * räknarna är en cache, listan är sanningen.
 */
export async function recomputeEventCounters(pb: PocketBase, tenant: string, eventId: string): Promise<void> {
  try {
    const rows = await pb.collection('event_signups').getFullList<{ stage?: string }>({
      filter: pb.filter('tenant = {:t} && event = {:e}', { t: tenant, e: eventId }),
      fields: 'id,stage'
    });
    await pb.collection('incubator_events').update(eventId, eventSignupCounters(rows));
  } catch {
    /* räknarna är en cache — listan är sanningen */
  }
}
