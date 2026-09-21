import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin'])) {
    redirect('/');
  }

  return (
    <PageShell
      title="Importera Excel-data"
      meta={<span className="text-sm text-foreground-muted">Administrationskonsol</span>}
      actions={
        <Link
          href="/integrationer"
          className="rounded-2xl border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-canvas-subtle"
        >
          Tillbaka till integrationer
        </Link>
      }
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="text-base font-semibold text-foreground">Generell import</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Ladda upp valfri Excel-fil och mappa varje ark mot en befintlig
            tabell i databasen. Du väljer själv vilken tabell ett ark ska
            skrivas till och vilken kolumn som hör till vilket fält — inga nya
            tabeller skapas. Befintliga rader uppdateras (upsert) via de
            nyckelfält du markerar; allt annat skapas som nya rader. Inget
            raderas.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
            <li>
              <strong>Steg 1–2:</strong> ladda upp filen och justera mappningen
              per ark. Auto-förslag fylls i — ändra fritt.
            </li>
            <li>
              <strong>Steg 3:</strong> förhandsgranska. Du ser exakt vad som
              kommer med, vilka kolumner som inte mappats och vilka rader som
              hoppas över (och varför) — utan att något sparas.
            </li>
            <li>
              <strong>Steg 4:</strong> bekräfta importen.
            </li>
          </ul>
        </section>

        <section className="rounded-3xl border border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
          <p className="font-medium text-foreground">
            Säkerhet &amp; dataskydd (CLAUDE.md § 9.3 / § 10 / § 21)
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Endast <strong>administratörer</strong> kan köra importen.
            </li>
            <li>
              Bara domäntabeller kan väljas — system- och hemlighetstabeller
              (användare, credentials, privata trådar) är aldrig valbara.
            </li>
            <li>
              Varje rad <strong>tenant-stämplas</strong> automatiskt så
              isoleringen bevaras.
            </li>
            <li>
              <strong>Personnummer</strong> i textfält ersätts med{' '}
              <code className="font-mono text-xs">[REDACTED]</code>. Fält märkta{' '}
              <span className="text-movexum-morkorange">⚠ PII</span> kräver
              rättslig grund.
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
