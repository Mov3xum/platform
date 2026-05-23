'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getOneForTenant } from '@/lib/pb.server';
import { hasRole } from '@/lib/rbac';

/**
 * Server actions för CRM-uppgifter (`tasks`, migration 1700000077).
 *
 * `logMeetingAsTaskAction` är "logga möte som uppgift"-flödet från
 * bolagskortet/kalendervyn: en människa loggar ett Outlook-möte explicit
 * som en CRM-task (kind='meeting'). Ingen autosync — människa-i-loopen
 * (CLAUDE.md § 10.1 mänsklig övervakning).
 */

export type LogMeetingState = {
  error?: string;
  summary?: string;
};

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

export async function logMeetingAsTaskAction(
  _prev: LogMeetingState,
  formData: FormData
): Promise<LogMeetingState> {
  const user = await requireUser();

  // RBAC: speglar tasks.createRule (STAFF_ROLES). Defense-in-depth ovanpå
  // PB API-reglerna.
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    return { error: 'Endast personal kan logga möten som uppgifter.' };
  }

  const subject = String(formData.get('subject') || '').trim();
  const startsAt = String(formData.get('starts_at') || '').trim();
  const endsAt = String(formData.get('ends_at') || '').trim();
  const startupId = String(formData.get('startup_id') || '').trim();
  const contactId = String(formData.get('contact_id') || '').trim();

  if (!subject) return { error: 'Mötet saknar ämne.' };
  if (!startupId) return { error: 'Inget bolag angivet.' };

  const startMs = Date.parse(startsAt);
  if (!Number.isFinite(startMs)) return { error: 'Ogiltig starttid.' };
  const endMs = Date.parse(endsAt);
  const dueIso = Number.isFinite(endMs) ? new Date(endMs).toISOString() : undefined;
  const startIso = new Date(startMs).toISOString();

  const pb = await getServerPb();

  // Tenant-isolation: verifiera att bolaget finns i användarens tenant.
  try {
    await getOneForTenant('startups', startupId);
  } catch {
    return { error: 'Bolaget hittades inte i din organisation.' };
  }

  const description = subject.slice(0, 500);

  // Best-effort dedup (idempotens, SOC 2 § 10.4): samma bolag + möte + start
  // + ämne loggas inte två gånger.
  try {
    const existing = await pb.collection('tasks').getList(1, 1, {
      filter: pb.filter(
        'startup = {:s} && kind = "meeting" && starts_at = {:t} && description = {:d}',
        { s: startupId, t: startIso, d: description }
      )
    });
    if (existing.items.length > 0) {
      return { summary: 'Redan loggad.' };
    }
  } catch {
    /* om dedup-frågan fallerar, fortsätt och skapa ändå */
  }

  // Möte som redan passerat loggas som klart; framtida som öppet.
  const status = startMs < Date.now() ? 'done' : 'open';

  try {
    await pb.collection('tasks').create({
      tenant: user.tenant,
      kind: 'meeting',
      description,
      starts_at: startIso,
      due_at: dueIso ?? null,
      completed_at: status === 'done' ? startIso : null,
      status,
      owner: user.id,
      // Primär länk = bolaget (det är där uppgiften visas på kortet);
      // kontakten lagras som sekundär referens när vi matchat en.
      link_kind: 'startup',
      startup: startupId,
      contact: contactId || null
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte skapa uppgiften.'
    };
  }

  revalidatePath(`/startups/${startupId}`);
  revalidatePath('/integrationer/outlook-calendar');
  return { summary: 'Loggad ✓' };
}
