import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, CardHead, Chip, Icon } from '@/components/proto';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  EVENT_SIGNUP_STAGE_LABEL,
  formatStockholmDateTime,
  isContactCategory,
  isEventSignupStage,
  rsvpOpen,
  type Role
} from '@platform/shared';
import { buildInflodeTabs } from '../../_tabs';
import { InvitePicker, SendButtons, type ContactOption } from './InviteControls';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const SEARCH_LIMIT = 50;

type Invitee = {
  id: string;
  name: string;
  organization?: string;
  stage: string;
  contact?: string;
  invited_at?: string;
  invite_sent_at?: string;
  responded_at?: string;
};

type ContactRow = {
  id: string;
  first_name?: string;
  last_name?: string;
  organization?: string;
  email?: string;
  invite_opt_out?: boolean;
};

/**
 * Inbjudningar för ett event (CLAUDE.md § 53.5): sök kontakter i
 * kontaktboken, bjud in (mejlet går direkt) och följ svaren. Inbjudna ligger
 * i eventets deltagarlista — samma rader som närvaron och utvärderingen
 * bygger på. Personuppgifter visas bara för staff (samma krets som
 * kontaktboken); e-postadresser visas aldrig här.
 */
export default async function EventInvitationsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; kategori?: string }>;
}) {
  const { id } = await params;
  const { q: qRaw, kategori } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) redirect('/inflode');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) notFound();
  const pb = await getServerPb();

  const event = await getRecordInTenant<{ id: string; tenant?: string; name?: string; starts_at?: string; ends_at?: string; location?: string }>(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    'incubator_events',
    id,
    'id,tenant,name,starts_at,ends_at,location'
  );
  if (!event) notFound();
  const open = rsvpOpen(event, new Date(), 'yes');

  let invitees: Invitee[] = [];
  try {
    invitees = await pb.collection('event_signups').getFullList<Invitee>({
      filter: pb.filter('tenant = {:t} && event = {:e} && invited_at != ""', { t: user.tenant, e: event.id }),
      fields: 'id,name,organization,stage,contact,invited_at,invite_sent_at,responded_at',
      sort: 'name'
    });
  } catch {
    invitees = [];
  }
  const unsent = invitees.filter((i) => i.stage === 'invited' && !i.invite_sent_at).length;
  const unanswered = invitees.filter((i) => i.stage === 'invited' && i.invite_sent_at).length;
  const coming = invitees.filter((i) => i.stage !== 'invited' && i.stage !== 'declined').length;
  const declined = invitees.filter((i) => i.stage === 'declined').length;

  // Sök i kontaktboken (§ 45) — bundna filtervärden, högst 50 träffar.
  const q = (qRaw || '').trim().slice(0, 80);
  const category = isContactCategory(kategori) ? kategori : '';
  let contacts: ContactOption[] = [];
  if (open && (q || category)) {
    const parts = ['tenant = {:t}'];
    const p: Record<string, string> = { t: user.tenant };
    if (q) {
      parts.push('(first_name ~ {:q} || last_name ~ {:q} || organization ~ {:q} || email ~ {:q})');
      p.q = q;
    }
    if (category) {
      parts.push('category = {:c}');
      p.c = category;
    }
    try {
      const res = await pb.collection('contacts').getList<ContactRow>(1, SEARCH_LIMIT, {
        filter: pb.filter(parts.join(' && '), p),
        fields: 'id,first_name,last_name,organization,email,invite_opt_out',
        sort: 'last_name,first_name'
      });
      const onList = new Set(invitees.map((i) => i.contact).filter(Boolean));
      contacts = res.items.map((c) => ({
        id: c.id,
        name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Kontakt',
        organization: c.organization || '',
        hasEmail: Boolean(c.email),
        optedOut: c.invite_opt_out === true,
        alreadyInvited: onList.has(c.id)
      }));
    } catch {
      contacts = [];
    }
  }

  return (
    <PageShell
      title="Marknadsverktyg"
      tabs={buildInflodeTabs()}
      meta={<span className="text-[12px] text-foreground-subtle">Inbjudningar / {event.name || 'Event'}</span>}
      actions={
        <Link href={`/events/${event.id}`} className="mx-btn">
          <Icon name="calendar" size={12} /> Till eventet
        </Link>
      }
    >
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mx-disp mx-fw-6" style={{ fontSize: 18 }}>
              {event.name || 'Event'}
            </div>
            <div className="mx-t-12 mx-muted" style={{ marginTop: 4 }}>
              {formatStockholmDateTime(event.starts_at) || 'Datum saknas'}
              {event.location ? ` · ${event.location}` : ''}
            </div>
          </div>
          <span className="mx-flex mx-gap-2" style={{ flexWrap: 'wrap' }}>
            <Chip mono>{invitees.length} INBJUDNA</Chip>
            <Chip variant="active" mono>
              {coming} KOMMER
            </Chip>
            <Chip mono>{declined} AVBÖJT</Chip>
            <Chip variant="draft" mono>
              {unanswered} INTE SVARAT
            </Chip>
          </span>
        </div>
        {open ? (
          <div style={{ marginTop: 12 }}>
            <SendButtons eventId={event.id} unsent={unsent} unanswered={unanswered} />
          </div>
        ) : (
          <div className="mx-t-12 mx-muted" style={{ marginTop: 12 }}>
            Eventet har ägt rum — inbjudningar kan inte längre skickas. Markera närvaron på eventet.
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        {open && (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <CardHead label="Bjud in från kontaktboken" />
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <form method="get" className="mx-flex mx-gap-2 mx-wrap" style={{ alignItems: 'end' }}>
                <label className="mx-t-12 mx-muted" style={{ flex: '1 1 180px' }}>
                  Sök (namn, organisation, e-post)
                  <input name="q" defaultValue={q} maxLength={80} className="mx-input" />
                </label>
                <label className="mx-t-12 mx-muted" style={{ flex: '0 1 160px' }}>
                  Kategori
                  <select name="kategori" defaultValue={category} className="mx-input">
                    <option value="">Alla</option>
                    {CONTACT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CONTACT_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="mx-btn">
                  Sök
                </button>
              </form>
              {q || category ? (
                <InvitePicker eventId={event.id} contacts={contacts} />
              ) : (
                <div className="mx-muted mx-t-13">Sök eller välj en kategori för att hitta kontakter att bjuda in (högst {SEARCH_LIMIT} per sökning).</div>
              )}
              <div className="mx-t-12 mx-muted">
                Rättslig grund: berättigat intresse. Varje mejl har en personlig svarslänk och en
                avregistreringslänk; den som avregistrerat sig kan inte väljas.
              </div>
            </div>
          </Card>
        )}

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead label={`Inbjudna · ${invitees.length}`} />
          {invitees.length === 0 ? (
            <div className="mx-muted mx-t-13" style={{ padding: 24, textAlign: 'center' }}>
              Ingen är inbjuden ännu.
            </div>
          ) : (
            <div>
              {invitees.map((i, idx) => (
                <div
                  key={i.id}
                  className="mx-flex mx-items-c mx-gap-3"
                  style={{ padding: '10px 16px', borderBottom: idx < invitees.length - 1 ? '1px solid var(--mx-line-soft)' : 'none' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mx-t-13 mx-fw-6 mx-truncate">{i.name}</div>
                    <div className="mx-mono mx-t-xs mx-muted mx-truncate">
                      {i.organization || '—'}
                      {i.invite_sent_at ? ` · skickad ${formatStockholmDateTime(i.invite_sent_at)}` : ' · ej utskickad'}
                    </div>
                  </div>
                  <Chip variant={i.stage === 'declined' ? 'default' : i.stage === 'invited' ? 'draft' : 'active'} mono>
                    {isEventSignupStage(i.stage) ? EVENT_SIGNUP_STAGE_LABEL[i.stage] : i.stage}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
