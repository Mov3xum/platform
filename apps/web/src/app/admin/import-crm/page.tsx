import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function ImportCrmPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/');
  }

  return (
    <PageShell
      title="Importera CRM-export"
      meta={
        <span className="text-sm text-foreground-muted">Administrationskonsol</span>
      }
      actions={
        <Link
          href="/integrationer"
          className="rounded-2xl border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-canvas-subtle"
        >
          Tillbaka till integrationer
        </Link>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="text-base font-semibold text-foreground">Vad gör importen?</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Läser Movexums tidigare CRM-export (Excel, 12 ark) och skriver
            idempotent till plattformens kollektioner. Befintliga rader
            uppdateras, nya skapas — inga rader raderas.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
            <li>
              <strong>Företag</strong> →{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                startups
              </code>{' '}
              (uppslag på org-nr, annars namn) + fashistorik från
              Inträde-kolumnerna
            </li>
            <li>
              <strong>Personer</strong> →{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                contacts
              </code>{' '}
              (kräver GDPR-samtycke)
            </li>
            <li>
              <strong>Företag-Person</strong> →{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                startup_contacts
              </code>
            </li>
            <li>
              <strong>Aktiviteter / Deltagare</strong> →{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                incubator_events
              </code>{' '}
              /{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                event_signups
              </code>
            </li>
            <li>
              <strong>Kapital / IPR / Avtal / ToDo / Mätetal</strong> →{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                capital_rounds
              </code>
              ,{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                intellectual_property
              </code>
              ,{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                agreements
              </code>
              ,{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                tasks
              </code>
              ,{' '}
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                startup_kpis
              </code>
            </li>
          </ul>
        </section>

        <section className="rounded-3xl border border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
          <p className="font-medium text-foreground">
            GDPR-skydd (CLAUDE.md § 15.4 / § 15.6)
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Personer <strong>utan GDPR-samtycke hoppas över</strong> och
              listas som varning.
            </li>
            <li>
              Kolumnen <code className="font-mono text-xs">Person nr</code> läses
              aldrig in. Personnummer i Info-/anteckningsfält ersätts med{' '}
              <code className="font-mono text-xs">[REDACTED]</code>.
            </li>
            <li>
              Filen läses lokalt på servern (Coolify / UpCloud, EU). Inget
              skickas till tredje part.
            </li>
          </ul>
        </section>

        <ImportForm />
      </div>
    </PageShell>
  );
}
