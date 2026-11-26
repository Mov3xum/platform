import { PageShell } from '@/components/PageShell';
import { sparkImportAllowedValues } from '@platform/shared';
import { Panel } from '@/components/talent/ui';
import { ImportForm } from '@/components/spark/controls';
import { SPARK_TITLE, requireSpark, sparkTabs } from '../_shared';

export const dynamic = 'force-dynamic';

/** Import av intervjuer gjorda utanför plattformen (§ 61) — mall, förhandsgranskning, bekräfta. */
export default async function SparkImportPage() {
  const { canManage, staff } = await requireSpark();
  const allowed = sparkImportAllowedValues();
  return (
    <PageShell title={SPARK_TITLE} tabs={sparkTabs(staff)}>
      <div className="mx-auto max-w-4xl space-y-5">
        <Panel title="Importera intervjuer">
          <p className="mb-4 text-sm text-foreground-muted">
            För intervjuer som görs i ett eget dokument. Använd mallen så blir svaren jämförbara och går att matcha. En rad per företag; har ett företag flera
            behov eller lösningar läggs de till efteråt i intervjun här i plattformen.
          </p>
          {staff && !canManage ? <p className="text-sm text-foreground-muted">Din roll kan läsa registret men inte importera.</p> : <ImportForm canApply={canManage} />}
        </Panel>
        <Panel title="Fasta svarskategorier" meta={<span className="text-xs text-foreground-subtle">skriv exakt som nedan — flera värden skiljs med semikolon</span>}>
          <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            {allowed.map((a) => (
              <div key={a.header}>
                <dt className="text-xs font-semibold text-foreground">
                  {a.header}
                  {a.multi ? <span className="font-normal text-foreground-subtle"> · flera</span> : null}
                </dt>
                <dd className="mt-0.5 text-xs text-foreground-muted">{a.values.join(' · ')}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </PageShell>
  );
}
