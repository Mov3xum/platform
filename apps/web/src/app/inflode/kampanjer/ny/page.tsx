import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card } from '@/components/proto';
import { createCampaignAndRedirect } from '@/lib/actions/email-campaigns';
import { getCampaign } from '@/lib/email/campaign-data';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  EMAIL_CATEGORY_LABELS,
  EMAIL_TEMPLATES,
  formatStockholmDateTime,
  startOfStockholmDay,
  toPocketBaseDateTime
} from '@platform/shared';
import { buildInflodeTabs } from '../../_tabs';
import { TemplatePicker } from './TemplatePicker';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

/**
 * Ny kampanj (§ 55.3): välj en av Movexums mallstrukturer (eller en egen
 * sparad mall), koppla ev. ett event och ge kampanjen ett namn. Kampanjen
 * skapas som utkast och öppnas i editorn.
 */
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ from?: string; event?: string }> }) {
  const { from, event } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) redirect('/inflode');
  const pb = await getServerPb();

  const fromTemplate = from && /^[a-zA-Z0-9_-]{1,64}$/.test(from) ? await getCampaign(pb, user.tenant, from) : null;

  // Kommande event (och senaste veckan) att koppla till — tenant-filtrerat med användarens token.
  let events: Array<{ id: string; name: string; starts_at?: string }> = [];
  try {
    const since = new Date(startOfStockholmDay(new Date()).getTime() - 7 * 24 * 3600 * 1000);
    events = await pb.collection(PB_COLLECTIONS.events).getFullList<{ id: string; name: string; starts_at?: string }>({
      filter: pb.filter('tenant = {:t} && starts_at >= {:from} && status != "cancelled"', { t: user.tenant, from: toPocketBaseDateTime(since) }),
      fields: 'id,name,starts_at',
      sort: 'starts_at',
      batch: 200
    });
  } catch {
    events = [];
  }

  return (
    <PageShell title="Ny kampanj" tabs={buildInflodeTabs()} activeTabId="kampanjer">
      <div className="space-y-4 py-4" style={{ maxWidth: 920 }}>
        <p className="mx-t-13 mx-muted" style={{ margin: 0 }}>
          Välj en struktur att utgå från. Allt går att ändra i editorn efteråt — block, färg, avsändare och mottagare.{' '}
          <Link href="/inflode/kampanjer" className="text-link">
            Tillbaka till kampanjerna
          </Link>
        </p>
        <Card style={{ padding: 20 }}>
          <form action={createCampaignAndRedirect} className="space-y-5">
            {fromTemplate ? (
              <div className="mx-t-13" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--movexum-pastell-bla)' }}>
                Utgår från er egen mall <strong>{fromTemplate.title}</strong> ({EMAIL_CATEGORY_LABELS[fromTemplate.category]}).
                <input type="hidden" name="from" value={fromTemplate.id} />
              </div>
            ) : (
              <TemplatePicker
                templates={EMAIL_TEMPLATES.map((t) => ({
                  key: t.key,
                  name: t.name,
                  summary: t.summary,
                  category: EMAIL_CATEGORY_LABELS[t.category],
                  needsEvent: t.needsEvent,
                  accent: t.design.accent,
                  layout: t.design.layout
                }))}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="mx-field">
                <span className="mx-label">Namn på kampanjen (internt)</span>
                <input name="title" maxLength={120} placeholder="T.ex. Frukostträff 12 nov — inbjudan" className="mx-input" />
              </label>
              <label className="mx-field">
                <span className="mx-label">Kopplat event (för tid, plats och svarsknappar)</span>
                <select name="event" className="mx-input" defaultValue={event && events.some((e) => e.id === event) ? event : ''}>
                  <option value="">Inget event</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.starts_at ? ` · ${formatStockholmDateTime(e.starts_at)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mx-flex mx-items-c mx-gap-2">
              <button type="submit" className="mx-btn mx-primary">
                Skapa och öppna editorn
              </button>
              <Link href="/inflode/kampanjer" className="mx-btn">
                Avbryt
              </Link>
            </div>
          </form>
        </Card>
      </div>
    </PageShell>
  );
}
