import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  updateEventAction,
  deleteEventFormAction,
  type EventActionState
} from '@/lib/actions/events';
import { EventForm } from '@/components/EventForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { IncubatorEvent } from '@platform/shared';

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect(`/events/${id}`);
  }

  const pb = await getServerPb();
  let event: IncubatorEvent;
  try {
    event = await pb.collection(PB_COLLECTIONS.events).getOne<IncubatorEvent>(id);
  } catch {
    notFound();
  }
  if (event.tenant !== user.tenant) redirect('/events');

  async function updateAndRedirect(
    _prev: EventActionState,
    formData: FormData
  ): Promise<EventActionState> {
    'use server';
    const result = await updateEventAction(id, {}, formData);
    if (!result.error) redirect(`/events/${id}`);
    return result;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href={`/events/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till {event.name}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera event</h1>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <EventForm
          action={updateAndRedirect}
          submitLabel="Spara ändringar"
          initial={{
            name: event.name,
            type: event.type,
            status: event.status,
            starts_at: event.starts_at,
            ends_at: event.ends_at ?? undefined,
            location: event.location ?? undefined,
            description: event.description ?? undefined,
            accent: event.accent ?? 'cyan'
          }}
        />
      </div>

      <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Farozon</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Raderar eventet och alla anmälningar.
        </p>
        <div className="mt-4">
          <ConfirmDeleteButton
            action={deleteEventFormAction}
            hiddenField={{ name: 'event_id', value: id }}
            label="Radera event"
            description={`Du raderar "${event.name}". Detta går inte att ångra.`}
          />
        </div>
      </div>
    </main>
  );
}
