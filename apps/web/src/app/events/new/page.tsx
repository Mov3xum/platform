import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createEventAction, type EventActionState } from '@/lib/actions/events';
import { EventForm, type EventFormInitial } from '@/components/EventForm';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import { listSurveyTemplates } from '@/lib/surveys/store';
import {
  annualWheelEventStartInput,
  annualWheelRangeLabel,
  parseDateTimeInput,
  type Role
} from '@platform/shared';

async function createEventAndRedirect(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  'use server';
  const result = await createEventAction({}, formData);
  if (result.eventId) {
    const warnings = result.warnings?.length ? `?varning=${result.warnings.join(',')}` : '';
    redirect(`/events/${result.eventId}${warnings}`);
  }
  return result;
}

type WheelItemRow = {
  id: string;
  tenant?: string;
  title?: string;
  year?: number;
  month?: number;
  day?: number;
  end_month?: number;
  end_day?: number;
  notes?: string;
};

export default async function NewEventPage({
  searchParams
}: {
  searchParams?: Promise<{ fran?: string }>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/events');
  }
  const { fran } = (await searchParams) ?? {};

  // "Skapa event" från en årshjulsaktivitet (§ 53): posten slås upp
  // tenant-verifierat och förifyller namn, datum och beskrivning. Kopplingen
  // verifieras igen i createEventAction — det här är bara förifyllning.
  const pb = await getServerPb();
  const templates = await listSurveyTemplates(pb, user.tenant);
  let wheelItem: WheelItemRow | null = null;
  if (fran && /^[a-zA-Z0-9_-]{1,64}$/.test(fran)) {
    wheelItem = await getRecordInTenant<WheelItemRow>(
      pb,
      { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
      'annual_wheel_items',
      fran,
      'id,tenant,title,year,month,day,end_month,end_day,notes'
    );
  }
  const wheelMissing = Boolean(fran) && !wheelItem;

  let initial: EventFormInitial | undefined;
  if (wheelItem) {
    const startInput = annualWheelEventStartInput(wheelItem);
    initial = {
      name: wheelItem.title || '',
      starts_at: startInput ? parseDateTimeInput(startInput)?.toISOString() : undefined,
      description: wheelItem.notes || ''
    };
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

      {wheelMissing && (
        <p className="mb-4 rounded-xl bg-movexum-pastell-orange px-4 py-2.5 text-sm text-movexum-morkorange">
          Årshjulsaktiviteten hittades inte — eventet skapas fristående om du fortsätter.
        </p>
      )}

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <EventForm
          action={createEventAndRedirect}
          submitLabel="Skapa event"
          initial={initial}
          evaluationTemplates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            template_for: t.template_for
          }))}
          wheelItem={
            wheelItem
              ? {
                  id: wheelItem.id,
                  title: wheelItem.title || 'Aktivitet',
                  when: annualWheelRangeLabel({ ...wheelItem, year: wheelItem.year ?? new Date().getFullYear() })
                }
              : undefined
          }
        />
      </div>
    </main>
  );
}
