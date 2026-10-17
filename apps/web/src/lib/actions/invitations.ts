'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { inviteContactsToEvent, sendEventInvitations } from '@/lib/core/write/event-invitations';
import { requestOrigin } from '@/lib/request-origin';
import type { Role } from '@platform/shared';

// Marknadsverktyg → Inbjudningar (CLAUDE.md § 53.5). Tunna server actions:
// inloggad användare → skrivlagret, som äger roll-, tenant- och
// avregistreringskontrollerna. Alla utskick är mänskliga klick.

export type InvitationState = { ok?: boolean; error?: string; notice?: string };

function revalidateEvent(eventId: string) {
  revalidatePath('/inflode/inbjudningar');
  revalidatePath(`/inflode/inbjudningar/${eventId}`);
  revalidatePath(`/events/${eventId}`);
}

export async function inviteContactsAction(_prev: InvitationState, formData: FormData): Promise<InvitationState> {
  const user = await requireUser();
  const eventId = String(formData.get('event') || '');
  const res = await inviteContactsToEvent(
    await getServerPb(),
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    { eventId, contactIds: formData.getAll('contact'), baseUrl: await requestOrigin() }
  );
  if (!res.ok) return { error: res.error };
  revalidateEvent(eventId);
  const { invited, sent, failed, skipped } = res.value;
  const notes = [
    skipped.already ? `${skipped.already} fanns redan på listan` : '',
    skipped.optOut ? `${skipped.optOut} har avregistrerat sig` : '',
    skipped.noEmail ? `${skipped.noEmail} saknar e-post` : '',
    skipped.overCap ? `${skipped.overCap} över taket` : '',
    failed ? `${failed} mejl misslyckades — försök igen med "Skicka ej utskickade"` : ''
  ].filter(Boolean);
  return {
    ok: true,
    notice: `${invited} inbjudna, ${sent} mejl skickade.${notes.length ? ` ${notes.join(' · ')}.` : ''}`
  };
}

export async function sendInvitationsAction(input: { eventId: string; mode: 'pending' | 'reminder' }): Promise<InvitationState> {
  const user = await requireUser();
  const res = await sendEventInvitations(
    await getServerPb(),
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    { eventId: input.eventId, mode: input.mode === 'reminder' ? 'reminder' : 'pending', baseUrl: await requestOrigin() }
  );
  if (!res.ok) return { error: res.error };
  revalidateEvent(input.eventId);
  const { sent, failed, optedOut } = res.value;
  return {
    ok: true,
    notice: `${sent} mejl skickade${failed ? `, ${failed} misslyckades` : ''}${optedOut ? ` (${optedOut} avregistrerade hoppades över)` : ''}.`
  };
}
