import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { SPARK_INTERVIEW_STATUS_LABELS } from '@platform/shared';
import { listSparkReferrals } from '@/lib/spark/data';
import { Notice, Panel, btnGhost, fmtDate } from '@/components/talent/ui';
import { OrganizationForm, SharePanel } from '@/components/spark/controls';
import { SPARK_TITLE, requireSpark, sparkTabs } from '../_shared';

export const dynamic = 'force-dynamic';

/**
 * Dela SPARK (§ 61): varje partner (t.ex. en kommun) och varje medarbetare har
 * en egen länk till den publika anmälan. Företag som anmäler sig via länken
 * syns här med namn och status — aldrig med sina svar.
 */
export default async function SparkSharePage() {
  const { user, pb, staff } = await requireSpark();
  const organization = await pb
    .collection('users')
    .getOne<{ organization?: string }>(user.id, { fields: 'organization' })
    .then((u) => u.organization ?? '')
    .catch(() => '');
  const slug = user.tenantSlug;
  const referrals = await listSparkReferrals(user.tenant, user.id);
  const path = slug ? `/energi/${slug}?via=${user.id}` : '';
  const message =
    'Hej!\n\nNu finns SPARK — ett regionalt samarbete som kopplar ihop företag som har energiutmaningar med företag som har lösningar, och med testmiljöer där nya lösningar kan prövas.\n\nBerätta kort om era behov eller er lösning via länken nedan. Det tar ungefär tio minuter, frågorna anpassas efter vad som stämmer in på er, och ingenting delas med andra företag utan att ni har tillfrågats först.';

  return (
    <PageShell title={SPARK_TITLE} tabs={sparkTabs(staff)}>
      <div className="mx-auto max-w-4xl space-y-5">
        <Panel title="Sprid SPARK till företagen">
          <p className="mb-4 text-sm text-foreground-muted">
            Skicka länken i ett mejl eller nyhetsbrev, lägg QR-koden i en presentation eller på en affisch. Företagen fyller i själva, och Movexum tar hand om
            matchningen. Länken är din egen, så det syns vilka som kommit in via dig.
          </p>
          <div className="mb-5 rounded-2xl border border-default bg-canvas-subtle p-4">
            <OrganizationForm initial={organization} />
            <p className="mt-2 text-xs text-foreground-subtle">Företagen ser &quot;Du har fått länken av {organization || 'din organisation'}&quot; högst upp på sidan.</p>
          </div>
          {path ? (
            <SharePanel path={path} message={message}>
              <Link href={path} target="_blank" className={btnGhost}>
                Se hur sidan ser ut för företagen
              </Link>
            </SharePanel>
          ) : (
            <Notice kind="warning">Din organisation saknar en publik adress. Be Movexum lägga in den under Inställningar → Organisation.</Notice>
          )}
        </Panel>

        <Panel title="Anmälningar via din länk" meta={<span className="text-xs text-foreground-subtle mx-tnum">{referrals ? referrals.length : '–'}</span>}>
          {referrals === null ? (
            <p className="text-sm text-foreground-muted">Listan kan inte visas just nu.</p>
          ) : referrals.length === 0 ? (
            <p className="text-sm text-foreground-muted">Ingen har anmält sig via din länk än.</p>
          ) : (
            <ul className="divide-y divide-default">
              {referrals.map((r, i) => (
                <li key={`${r.company_name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="font-medium text-foreground">{r.company_name}</span>
                  <span className="text-xs text-foreground-subtle">
                    {fmtDate(r.created)} · {SPARK_INTERVIEW_STATUS_LABELS[r.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-foreground-subtle">Du ser att ett företag har anmält sig, men inte vad det har svarat. Företaget får veta det innan det skickar in.</p>
        </Panel>

        <Panel title="Gör intervjun tillsammans med företaget">
          <p className="text-sm text-foreground-muted">
            Sitter du i ett möte med ett företag kan du fylla i åt dem under <Link href="/spark/intervjuer/ny" className="font-medium text-link hover:underline">Ny intervju</Link>. Har du redan gjort
            intervjuer i ett eget dokument laddar du upp dem under <Link href="/spark/import" className="font-medium text-link hover:underline">Import</Link>.
          </p>
        </Panel>
      </div>
    </PageShell>
  );
}
