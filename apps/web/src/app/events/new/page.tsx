import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createEventAction, type EventActionState } from '@/lib/actions/events';
import { EventForm } from '@/components/EventForm';

async function createEventAndRedirect(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  'use server';
  const result = await createEventAction({}, formData);
  if (result.eventId) {
    redirect(`/events/${result.eventId}`);
  }
  return result;
}

export default async function NewEventPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/events');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/events" className="text-sm text-foreground-muted hover:text-foreground">
          ← Alla events
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Nytt event</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Skapa ett event och börja samla anmälningar.
        </p>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <EventForm action={createEventAndRedirect} submitLabel="Skapa event" />
      </div>
    </main>
  );
}
