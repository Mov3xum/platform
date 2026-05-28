import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function ImportBolagslistaPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/');
  }

  return (
    <PageShell
      title="Importera Bolagslista"
      meta={
        <span className="text-sm text-foreground-muted">
          Administrationskonsol
        </span>
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
            Läser Movexums Bolagslista (Excel) och uppdaterar två tabeller idempotent.
            Stöder både den breda listan och den normaliserade exporten med separata
            flikar <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">Bolag</code>{' '}
            +{' '}
            <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
              Ekonomi per år
            </code>{' '}
            (en rad per bolag × år):
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
            <li>
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                startups
              </code>{' '}
              — namn, org-nr, kommun, bolagsstatus, intagsdatum, avslutsdatum
            </li>
            <li>
              <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
                startup_financials
              </code>{' '}
              — en rad per (bolag, år) med antal anställda, omsättning,
              personalkostnad och bolagsskatt
            </li>
          </ul>
          <p className="mt-3 text-sm text-foreground-muted">
            Värden ur kolumnerna är i tkr och multipliceras med 1000 vid skrivning.
            Unique-index på (startup, år) gör importen säker att köra om — befintliga
            rader uppdateras, inga dubbletter skapas.
          </p>
        </section>

        <section className="rounded-3xl border border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
          <p className="font-medium text-foreground">
            Filen läses lokalt på servern (Coolify / UpCloud, EU).
          </p>
          <p className="mt-1">
            Inga personuppgifter ingår — organisationsnummer för aktiebolag är inte
            PII enligt GDPR skäl 14. Enskilda firmor utan giltigt org-nr
            (XXXXXX-XXXX) får inget org-nr lagrat utan kopplas i stället på
            bolagsnamn, så deras ekonomirader behåller sin relation i stället för
            att hoppas över.
          </p>
        </section>

        <ImportForm />
      </div>
    </PageShell>
  );
}
