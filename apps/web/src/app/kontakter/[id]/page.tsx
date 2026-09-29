import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { escapeHtml, inlineMarkdown } from '@/lib/safe-html';
import {
  getContact,
  listContactRequests,
  listStaffUsers,
  listStartupLinksForContact,
  staffNameMap
} from '@/lib/contacts/data';
import {
  CONTACT_BOOK_ROLES,
  CONTACT_CATEGORY_LABELS,
  canDecideContactRequest,
  canWithdrawContactRequest,
  contactDisplayName,
  contactSubtitle,
  isContactBookAdmin,
  isContactOwner
} from '@platform/shared';
import { RequestPanel, type RequestView, type StartupOption } from './RequestPanel';
import { DeleteContactButton } from './DeleteContactButton';
import { BackLink, GdprBanner, Initials, OwnerChip, Panel, btnGhost, fmtDate } from '../ui';

export const dynamic = 'force-dynamic';

interface StartupRow {
  id: string;
  name: string;
  status?: string;
}

export default async function KontaktPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  const pb = await getServerPb();
  const contact = await getContact(pb, user.tenant, id);
  if (!contact) notFound();

  const canEdit = hasRole(user.roles, [...CONTACT_BOOK_ROLES]);
  const isAdmin = isContactBookAdmin(user.roles);
  const isOwner = isContactOwner(contact, user.id);

  const [staff, requests, links, startups] = await Promise.all([
    listStaffUsers(pb, user.tenant),
    listContactRequests(pb, user.tenant, { contactId: contact.id }),
    listStartupLinksForContact(pb, contact.id),
    pb
      .collection('startups')
      .getFullList<StartupRow>({
        filter: pb.filter('tenant = {:tenant} && status = "active"', { tenant: user.tenant }),
        sort: 'name',
        fields: 'id,name,status',
        batch: 300
      })
      .catch(() => [] as StartupRow[])
  ]);
  const names = staffNameMap(staff);
  const nameOf = (uid: string | null | undefined, expandName?: string) =>
    (uid ? names.get(uid) : undefined) ?? expandName ?? 'Kollega';

  const requestViews: RequestView[] = requests.map((r) => ({
    id: r.id,
    status: r.status,
    purpose: r.purpose,
    requesterId: r.requester,
    requesterName: nameOf(r.requester, r.expand?.requester?.display_name),
    startupId: r.startup,
    startupName: r.expand?.startup?.name ?? null,
    startupRole: r.startup_role,
    decisionNote: r.decision_note,
    decidedByName: r.decided_by ? nameOf(r.decided_by, r.expand?.decided_by?.display_name) : null,
    decidedAt: r.decided_at,
    created: r.created ?? null,
    canDecide:
      canEdit &&
      r.status === 'pending' &&
      canDecideContactRequest({ userId: user.id, roles: user.roles, ownerIds: contact.owners.length > 0 ? contact.owners : r.owners }),
    canWithdraw: r.status === 'pending' && canWithdrawContactRequest({ userId: user.id, roles: user.roles, requesterId: r.requester })
  }));
  const highlight = typeof sp.request === 'string' ? sp.request : undefined;
  const startupOptions: StartupOption[] = startups.map((s) => ({ id: s.id, name: s.name }));
  const name = contactDisplayName(contact);
  const subtitle = contactSubtitle(contact);

  return (
    <PageShell
      title={name}
      meta={<BackLink href="/kontakter" label="Kontaktboken" />}
      actions={
        canEdit ? (
          <>
            <Link href={`/kontakter/${contact.id}/redigera`} className={btnGhost}>
              <Icon name="pencil" size={13} /> Redigera
            </Link>
            {isAdmin && <DeleteContactButton contactId={contact.id} name={name} />}
          </>
        ) : undefined
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-5">
          <Panel title="Kontakt">
            <div className="flex items-start gap-3">
              <Initials name={name} />
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-foreground">{name}</div>
                {subtitle && <div className="text-sm text-foreground-muted">{subtitle}</div>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {contact.category && (
                    <span className="inline-flex rounded-full bg-movexum-pastell-lila px-2 py-0.5 text-[11px] font-semibold text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
                      {CONTACT_CATEGORY_LABELS[contact.category]}
                    </span>
                  )}
                  {contact.kommun && <span className="text-xs text-foreground-subtle">{contact.kommun}</span>}
                </div>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-foreground-subtle">E-post</dt>
                <dd className="text-foreground">
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="text-link hover:underline">
                      {contact.email}
                    </a>
                  ) : (
                    '–'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-subtle">Telefon</dt>
                <dd className="text-foreground mx-tnum">
                  {contact.phone ? (
                    <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className="text-link hover:underline">
                      {contact.phone}
                    </a>
                  ) : (
                    '–'
                  )}
                </dd>
              </div>
              {contact.skills && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-foreground-subtle">Kompetenser / områden</dt>
                  <dd className="flex flex-wrap gap-1 pt-1">
                    {contact.skills
                      .split(/[,;\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((s) => (
                        <span key={s} className="rounded-full bg-canvas-muted px-2 py-0.5 text-xs text-foreground-muted">
                          {s}
                        </span>
                      ))}
                  </dd>
                </div>
              )}
              {contact.info && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-foreground-subtle">Info</dt>
                  <dd
                    className="whitespace-pre-wrap text-foreground"
                    dangerouslySetInnerHTML={{ __html: inlineMarkdown(escapeHtml(contact.info.replace(/<[^>]+>/g, ''))) }}
                  />
                </div>
              )}
              <div className="sm:col-span-2 text-xs text-foreground-subtle">
                Registrerad {fmtDate(contact.created)}
                {contact.gdpr_consent_at ? ` · samtycke ${fmtDate(contact.gdpr_consent_at)}` : ''}
              </div>
            </dl>
          </Panel>

          <Panel title="Ägare">
            {contact.owners.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                Ingen ägare angiven — förfrågningar går till admin/incubator lead.{' '}
                {canEdit && (
                  <Link href={`/kontakter/${contact.id}/redigera`} className="text-link hover:underline">
                    Sätt ägare
                  </Link>
                )}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {contact.owners.map((uid) => (
                  <OwnerChip key={uid} name={names.get(uid) ?? 'Kollega'} isMe={uid === user.id} />
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-foreground-subtle">
              Ägaren är den kollega som har relationen till kontakten och som godkänner när någon annan vill använda den.
            </p>
          </Panel>

          <Panel title="Kopplade bolag" meta={<span className="text-xs text-foreground-subtle mx-tnum">{links.length}</span>}>
            {links.length === 0 ? (
              <p className="text-sm text-foreground-muted">Kontakten är inte kopplad till något bolag ännu.</p>
            ) : (
              <ul className="divide-y divide-default">
                {links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link href={`/startups/${l.startup}`} className="font-medium text-foreground hover:underline">
                      {l.expand?.startup?.name ?? 'Bolag'}
                    </Link>
                    {l.role && <span className="text-foreground-muted">— {l.role}</span>}
                    {l.is_primary && <span className="text-[11px] text-foreground-subtle">primärkontakt</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="Förfrågningar"
            meta={
              requestViews.some((r) => r.status === 'pending') ? (
                <span className="inline-flex rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-[11px] font-semibold text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul">
                  {requestViews.filter((r) => r.status === 'pending').length} väntar
                </span>
              ) : undefined
            }
          >
            <RequestPanel
              contactId={contact.id}
              contactName={name}
              isOwner={isOwner}
              canRequest={canEdit}
              startups={startupOptions}
              requests={requestViews}
              highlightId={highlight}
            />
          </Panel>
          <GdprBanner />
        </div>
      </div>
    </PageShell>
  );
}
