import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, CardHead, Chip, Icon } from '@/components/proto';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import {
  EVENT_SIGNUP_STAGE_LABEL,
  INVITE_STATUS_LABEL,
  SURVEY_STARTER_TEMPLATES,
  canRemoveInvitation,
  defaultEvaluationTemplateRef,
  formatStockholmDateTime,
  getSurveyStarterTemplate,
  inviteStatus,
  isEventSignupStage,
  rsvpOpen,
  tallyInvites,
  starterTemplateRef,
  type Role
} from '@platform/shared';
import { InvitePanel } from '@/components/invitations/InvitePanel';
import { RemoveInviteButton } from '@/components/invitations/RemoveInviteButton';
import { FollowUpSurveys } from '@/components/surveys/FollowUpSurveys';
import { createEventEvaluationAction } from '@/lib/actions/events';
import { listSurveyTemplates } from '@/lib/surveys/store';
import { buildInflodeTabs } from '../../_tabs';
import { SendButtons } from './InviteControls';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

type Invitee = {
  id: string;
  name: string;
  organization?: string;
  stage: string;
  contact?: string;
  invited_at?: string;
  invite_sent_at?: string;
  invite_opened_at?: string;
  responded_at?: string;
};

/**
 * Inbjudningar för ett event (CLAUDE.md § 53.5): kryssa i kontakter per
 * kategori eller hela bolag, bjud in (mejlet går direkt) och följ svaren.
 * Inbjudna ligger i eventets deltagarlista — samma rader som närvaron och
 * utvärderingen bygger på. Här väljs också mallen för utvärderingen efter
 * eventet. Personuppgifter visas bara för staff (samma krets som
 * kontaktboken); e-postadresser visas aldrig här.
 */
export default async function EventInvitationsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fel?: string }>;
}) {
  const { id } = await params;
  const { fel } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) redirect('/inflode');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) notFound();
  const pb = await getServerPb();

  const event = await getRecordInTenant<{
    id: string;
    tenant?: string;
    name?: string;
    type?: string;
    starts_at?: string;
    ends_at?: string;
    location?: string;
  }>(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    'incubator_events',
    id,
    'id,tenant,name,type,starts_at,ends_at,location'
  );
  if (!event) notFound();
  const open = rsvpOpen(event, new Date(), 'yes');

  let invitees: Invitee[] = [];
  try {
    invitees = await pb.collection('event_signups').getFullList<Invitee>({
      filter: pb.filter('tenant = {:t} && event = {:e} && invited_at != ""', { t: user.tenant, e: event.id }),
      fields: 'id,name,organization,stage,contact,invited_at,invite_sent_at,invite_opened_at,responded_at',
      sort: 'name'
    });
  } catch {
    invitees = [];
  }
  const { unsent, unanswered, coming, declined, opened } = tallyInvites(invitees);

  // Utvärderingen efter eventet (§ 53.3): egen mall för typen, annars
  // Movexums standardmall — samma val som när eventet skapas.
  const templates = await listSurveyTemplates(pb, user.tenant);
  const defaultTemplate = defaultEvaluationTemplateRef(templates, event.type);
  const defaultTemplateName =
    getSurveyStarterTemplate(defaultTemplate)?.name ?? templates.find((t) => t.id === defaultTemplate)?.name ?? '';

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
            <Chip mono>{opened} ÖPPNAT</Chip>
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
            <CardHead label="Bjud in" />
            <div style={{ padding: 16 }}>
              <InvitePanel eventId={event.id} />
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
                      {i.invite_opened_at ? ` · öppnad ${formatStockholmDateTime(i.invite_opened_at)}` : ''}
                    </div>
                  </div>
                  <Chip variant={i.stage === 'declined' ? 'default' : i.stage === 'invited' ? 'draft' : 'active'} mono>
                    {i.stage === 'invited'
                      ? INVITE_STATUS_LABEL[inviteStatus(i)]
                      : isEventSignupStage(i.stage)
                        ? EVENT_SIGNUP_STAGE_LABEL[i.stage]
                        : i.stage}
                  </Chip>
                  {canRemoveInvitation(i) && <RemoveInviteButton signupId={i.id} name={i.name || 'mottagaren'} />}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
        <CardHead label="Utvärdering efter eventet" />
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          {fel === 'utvardering' && (
            <div
              role="alert"
              className="mx-t-13"
              style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-orange)', color: 'var(--movexum-morkorange)' }}
            >
              Utvärderingen kunde inte skapas. Försök igen eller skapa den under Utvärdering.
            </div>
          )}
          <form action={createEventEvaluationAction} className="mx-flex mx-gap-2 mx-wrap" style={{ alignItems: 'end' }}>
            <input type="hidden" name="event" value={event.id} />
            <label className="mx-t-12 mx-muted" style={{ flex: '1 1 260px' }}>
              Mall
              <select name="evaluation" defaultValue="auto" className="mx-input">
                <option value="auto">{`Mallen för eventtypen (${defaultTemplateName || 'saknas'})`}</option>
                {templates.length > 0 && (
                  <optgroup label="Era mallar">
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Movexums standardmallar">
                  {SURVEY_STARTER_TEMPLATES.map((t) => (
                    <option key={t.key} value={starterTemplateRef(t.key)}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <button type="submit" className="mx-btn mx-primary">
              <Icon name="plus" size={12} /> Skapa utvärdering
            </button>
          </form>
          <div className="mx-t-12 mx-muted">
            Skapas som utkast kopplat till eventet. Ni granskar, publicerar och schemalägger utskicket — det går
            bara till dem som markerats närvarande.
          </div>
          <FollowUpSurveys pb={pb} tenant={user.tenant} kind="event" id={event.id} canCreate={false} compact />
        </div>
      </Card>
    </PageShell>
  );
}
