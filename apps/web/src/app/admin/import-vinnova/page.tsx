import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function ImportVinnovaPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/');
  }

  return (
    <PageShell
      title="Importera Vinnova-underlag"
      meta={<span className="text-sm text-foreground-muted">Administrationskonsol</span>}
      actions={
        <Link
          href="/rapporter/vinnova"
          className="rounded-2xl border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-canvas-subtle"
        >
          Till lägesredovisningen
        </Link>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="text-base font-semibold text-foreground">Vad gör importen?</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Läser Movexums historiska Vinnova-arbetsfiler och fyller systemet så att
            lägesredovisningen kan auto-genereras. Filtypen känns igen automatiskt.
            Idempotent — befintliga rader hoppas över, inga raderas.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
            <li>
              <strong>Lägesredovisning aktiebolag</strong> → backfillar bolagens
              affärsinriktning, SNI, statsstödsstart/-slut, statsstödsgrund och
              readiness-bedömningar (CRL/TMRL/BRL/SRL).
            </li>
            <li>
              <strong>Inrapporterad tid</strong> → tidsposter (tim × timpris →
              inkubatortjänster). Kräver ett periodatum.
            </li>
            <li>
              <strong>Kostnader bolag</strong> → kolumnen ”Externa tjänster” blir
              verifieringskostnader per bolag. Kräver ett periodatum.
            </li>
          </ul>
          <p className="mt-3 text-xs text-foreground-subtle">
            Bolag matchas på org-nr (lägesredovisning) eller normaliserat namn.
            Personnummer läses aldrig in.
          </p>
        </section>

        <ImportForm />
      </div>
    </PageShell>
  );
}
