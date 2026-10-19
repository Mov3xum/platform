import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { checkInByToken } from '@/lib/events/checkin';
import { formatStockholmDateTime } from '@platform/shared';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Incheckning', robots: { index: false } };

const FAIL_TEXT: Record<string, string> = {
  lank: 'QR-koden är ogiltig eller har ersatts av en nyare biljett. Be gästen öppna sitt senaste mejl.',
  fel_event: 'Biljetten gäller ett annat event.',
  tenant: 'Biljetten tillhör en annan organisation.',
  spara: 'Incheckningen kunde inte sparas. Försök skanna igen.'
};

/**
 * Incheckning vid dörren (§ 54.11). Personalen skannar gästens QR-kod med
 * telefonen → den här inloggade sidan checkar in gästen direkt och visar
 * namn, medföljande och ev. kost. Utan token visas en kort instruktion.
 */
export default async function CheckInPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode/events');
  const pb = await getServerPb();
  let event: { id: string; tenant: string; name?: string; starts_at?: string } | null = null;
  try {
    event = await pb.collection(PB_COLLECTIONS.events).getOne(id, { fields: 'id,tenant,name,starts_at' });
  } catch {
    notFound();
  }
  if (!event || event.tenant !== user.tenant) notFound();

  const result = t ? await checkInByToken({ token: t, eventId: event.id, tenant: user.tenant }) : null;
  const tone = !result ? 'var(--color-foreground-muted)' : result.ok ? (result.already ? 'var(--movexum-morkgul)' : 'var(--movexum-morkgron)') : 'var(--movexum-morkorange)';

  return (
    <div className="mx-view-pad" style={{ maxWidth: 560, margin: '0 auto' }}>
      <p className="text-xs uppercase tracking-wide text-foreground-subtle">Incheckning · {event.name}</p>
      <p className="text-sm text-foreground-muted">{formatStockholmDateTime(event.starts_at) || ''}</p>
      <section className="mt-4 rounded-2xl border border-default bg-surface p-6" style={{ borderLeft: `6px solid ${tone}` }}>
        {!result ? (
          <>
            <h1 className="font-heading text-xl">Skanna gästens QR-kod</h1>
            <p className="mt-2 text-sm text-foreground-muted">
              Öppna kameran på telefonen och skanna QR-koden i gästens biljett. Du landar här igen och gästen checkas in direkt.
            </p>
          </>
        ) : result.ok ? (
          <>
            <h1 className="font-heading text-2xl">{result.already ? 'Redan incheckad' : 'Incheckad ✓'}</h1>
            <p className="mt-2 text-lg">{result.name}</p>
            <dl className="mt-3 grid gap-1 text-sm text-foreground-muted">
              {result.plusOnes > 0 && (
                <div>
                  <dt className="inline font-semibold">Medföljande: </dt>
                  <dd className="inline">{result.plusOnes}</dd>
                </div>
              )}
              {result.diet && (
                <div>
                  <dt className="inline font-semibold">Kost/allergi: </dt>
                  <dd className="inline">{result.diet}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-semibold">{result.already ? 'Checkades in: ' : 'Tid: '}</dt>
                <dd className="inline">{formatStockholmDateTime(result.checkedInAt) || result.checkedInAt}</dd>
              </div>
            </dl>
          </>
        ) : (
          <>
            <h1 className="font-heading text-xl">Kunde inte checka in</h1>
            <p className="mt-2 text-sm text-foreground-muted">{FAIL_TEXT[result.reason]}</p>
          </>
        )}
      </section>
      <div className="mt-4 flex gap-2">
        <Link href={`/inflode/events/${encodeURIComponent(event.id)}`} className="mx-btn">
          Till deltagarlistan
        </Link>
      </div>
    </div>
  );
}
