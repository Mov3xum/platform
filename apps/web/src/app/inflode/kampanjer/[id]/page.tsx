import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listStaffUsers } from '@/lib/contacts/data';
import { getCampaign, listCampaignRecipients } from '@/lib/email/campaign-data';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { resolveReplyTo } from '@/lib/mail-sender';
import { startOfStockholmDay, toPocketBaseDateTime } from '@platform/shared';
import { buildInflodeTabs } from '../../_tabs';
import { CampaignEditor } from './CampaignEditor';
import { CampaignStats } from './CampaignStats';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

/**
 * En kampanj (CLAUDE.md § 54): utkast och schemalagda öppnas i editorn med
 * förhandsgranskning; skickade visar statistiken (levererat, studsar,
 * klagomål, klick per länk, avregistreringar) med mottagarna per status —
 * namn och organisation, aldrig e-postadresser (bara hashar lagras).
 */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) redirect('/inflode');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) notFound();
  const pb = await getServerPb();
  const campaign = await getCampaign(pb, user.tenant, id);
  if (!campaign) notFound();

  const orgName = user.tenantName || 'Movexum';
  const editable = campaign.status === 'draft' || campaign.status === 'scheduled';

  if (!editable) {
    const recipients = await listCampaignRecipients(pb, user.tenant, campaign.id);
    return (
      <PageShell title={campaign.title || campaign.subject || 'Kampanj'} tabs={buildInflodeTabs()} activeTabId="kampanjer">
        <CampaignStats campaign={campaign} recipients={recipients} />
      </PageShell>
    );
  }

  const [staff, events] = await Promise.all([
    listStaffUsers(pb, user.tenant),
    pb
      .collection(PB_COLLECTIONS.events)
      .getFullList<{ id: string; name: string; starts_at?: string; location?: string }>({
        filter: pb.filter('tenant = {:t} && starts_at >= {:from} && status != "cancelled"', {
          t: user.tenant,
          from: toPocketBaseDateTime(new Date(startOfStockholmDay(new Date()).getTime() - 30 * 24 * 3600 * 1000))
        }),
        fields: 'id,name,starts_at,location',
        sort: 'starts_at',
        batch: 200
      })
      .catch(() => [] as Array<{ id: string; name: string; starts_at?: string; location?: string }>)
  ]);
  // Ett redan kopplat event som ligger längre bak i tiden ska ändå gå att se.
  if (campaign.event && !events.some((e) => e.id === campaign.event)) {
    try {
      const ev = await pb.collection(PB_COLLECTIONS.events).getOne<{ id: string; tenant: string; name: string; starts_at?: string; location?: string }>(campaign.event, {
        fields: 'id,tenant,name,starts_at,location'
      });
      if (ev.tenant === user.tenant) events.unshift({ id: ev.id, name: ev.name, starts_at: ev.starts_at, location: ev.location });
    } catch {
      /* visas som "Inget event" */
    }
  }

  // Utvärderingar att koppla (§ 47): bara riktiga enkäter, inte mallar.
  const surveys = await pb
    .collection('surveys')
    .getFullList<{ id: string; name: string; link_kind?: string; link_id?: string }>({
      filter: pb.filter('tenant = {:t} && is_template != true', { t: user.tenant }),
      fields: 'id,name,link_kind,link_id',
      sort: '-created',
      batch: 200
    })
    .then((rows) => rows.map((sv) => ({ id: sv.id, name: sv.name, event: sv.link_kind === 'event' ? sv.link_id ?? '' : '' })))
    .catch(() => [] as Array<{ id: string; name: string; event: string }>);

  return (
    <PageShell title={campaign.is_template ? `Mall: ${campaign.title}` : campaign.title || 'Kampanj'} tabs={buildInflodeTabs()} activeTabId="kampanjer">
      <CampaignEditor
        campaign={campaign}
        staff={staff.map((s) => ({ id: s.id, name: s.name, hasEmail: Boolean(s.email) }))}
        events={events}
        surveys={surveys}
        orgName={orgName}
        replyToConfigured={Boolean(resolveReplyTo(process.env))}
        meEmail={user.email}
      />
    </PageShell>
  );
}
