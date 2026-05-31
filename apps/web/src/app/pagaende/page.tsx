import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import { WorkshopAssignmentStatusBadge } from '@/components/Badges';
import { activityTypeLabels, type ActivityType } from '@/lib/labels';
import { escFilter } from '@/lib/pb-filter';

export const dynamic = 'force-dynamic';

/**
 * "Pågående" — en tenant-bred översikt (CLAUDE.md § 18.4) som visar allt som
 * pågår med bolagen: tilldelade workshops, utbildningsdokument och öppna
 * aktiviteter, grupperat per bolag, så hela Movexum ser läget. Read-only.
 */

interface UserRef {
  id: string;
  display_name?: string;
  email: string;
}

interface MeetingRef {
  id: string;
  name: string;
  starts_at: string;
}

interface WorkshopRow {
  id: string;
  status: 'planned' | 'in_progress' | 'done';
  due_date?: string;
  instructions?: string;
  startup: string;
  created: string;
  expand?: {
    workshop?: { id: string; title: string };
    startup?: { id: string; name: string };
    assigned_by?: UserRef;
    collaborators?: UserRef[];
    meeting?: MeetingRef;
  };
}

interface DocRow {
  id: string;
  status: 'assigned' | 'completed';
  due_date?: string;
  instructions?: string;
  startup: string;
  created: string;
  expand?: {
    document?: { id: string; title: string };
    startup?: { id: string; name: string };
    collaborators?: UserRef[];
    meeting?: MeetingRef;
  };
}

interface ActivityRow {
  id: string;
  title: string;
  type: ActivityType;
  status: string;
  kind?: string;
  due_date?: string;
  startup: string;
  created: string;
  expand?: {
    startup?: { id: string; name: string };
    owner?: UserRef;
  };
}

interface CompanyGroup {
  id: string;
  name: string;
  workshops: WorkshopRow[];
  documents: DocRow[];
  activities: ActivityRow[];
}

function resourceNames(users?: UserRef[]): string {
  return (users ?? []).map((u) => u.display_name || u.email).join(', ');
}

export default async function PagaendePage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'pagaende', user.disabledModules)) redirect('/chatt');
  const pb = await getServerPb();
  const tenant = escFilter(user.tenant);

  const emptyList = { items: [] as never[] };
  const [workshopsRes, docsRes, activitiesRes] = await Promise.allSettled([
    pb.collection(PB_COLLECTIONS.workshopAssignments).getList<WorkshopRow>(1, 200, {
      filter: `tenant = "${tenant}" && status != "done"`,
      sort: '-created',
      expand: 'workshop,startup,assigned_by,collaborators,meeting'
    }),
    pb.collection(PB_COLLECTIONS.educationDocumentAssignments).getList<DocRow>(1, 200, {
      filter: `tenant = "${tenant}" && status != "completed"`,
      sort: '-created',
      expand: 'document,startup,collaborators,meeting'
    }),
    pb.collection('activities').getList<ActivityRow>(1, 200, {
      filter: `startup.tenant = "${tenant}" && (status = "planned" || status = "in_progress") && (kind = "manual" || kind = "")`,
      sort: '-created',
      expand: 'startup,owner'
    })
  ]);

  const workshops = workshopsRes.status === 'fulfilled' ? workshopsRes.value.items : emptyList.items;
  const documents = docsRes.status === 'fulfilled' ? docsRes.value.items : emptyList.items;
  const activities = activitiesRes.status === 'fulfilled' ? activitiesRes.value.items : emptyList.items;
  const loadFailed =
    workshopsRes.status === 'rejected' ||
    docsRes.status === 'rejected' ||
    activitiesRes.status === 'rejected';

  const groups = new Map<string, CompanyGroup>();
  const ensure = (id?: string, name?: string): CompanyGroup | null => {
    if (!id) return null;
    let g = groups.get(id);
    if (!g) {
      g = { id, name: name || 'Bolag', workshops: [], documents: [], activities: [] };
      groups.set(id, g);
    } else if (name && g.name === 'Bolag') {
      g.name = name;
    }
    return g;
  };

  for (const w of workshops) ensure(w.startup, w.expand?.startup?.name)?.workshops.push(w);
  for (const d of documents) ensure(d.startup, d.expand?.startup?.name)?.documents.push(d);
  for (const a of activities) ensure(a.startup, a.expand?.startup?.name)?.activities.push(a);

  const companies = [...groups.values()]
    .filter((g) => g.workshops.length + g.documents.length + g.activities.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  const totalItems = companies.reduce(
    (acc, c) => acc + c.workshops.length + c.documents.length + c.activities.length,
    0
  );

  return (
    <PageShell
      title="Pågående"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {companies.length} bolag · {totalItems} pågående
        </span>
      }
    >
      <div className="space-y-5 py-6">
        {loadFailed ? (
          <div className="rounded-xl border border-default bg-surface p-3 text-[13px] text-foreground-muted">
            Vissa poster kunde inte laddas just nu. Försök igen om en stund.
          </div>
        ) : null}

        {companies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
            Inget pågår med bolagen just nu.
          </div>
        ) : (
          companies.map((c) => (
            <section
              key={c.id}
              className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <Link
                  href={`/startups/${c.id}`}
                  className="font-heading text-[17px] font-semibold text-foreground hover:text-brand hover:underline"
                >
                  {c.name}
                </Link>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/mina-aktiviteter?startup=${c.id}`}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-link hover:underline"
                  >
                    <Icon name="flow" size={13} /> Aktiviteter & progress
                  </Link>
                  <span className="text-[11px] text-foreground-subtle">
                    {c.workshops.length + c.documents.length + c.activities.length} pågående
                  </span>
                </div>
              </div>

              <ul className="space-y-2">
                {c.workshops.map((w) => (
                  <li key={`w-${w.id}`} className="rounded-xl border border-default p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-lila text-movexum-lila">
                          <Icon name="cap" size={15} />
                        </span>
                        <div>
                          <p className="text-[13.5px] font-medium text-foreground">
                            <Link
                              href={`/education/assignments/${w.id}`}
                              className="hover:underline"
                            >
                              {w.expand?.workshop?.title || 'Workshop'}
                            </Link>
                            <span className="ml-1.5 text-[11px] font-normal text-foreground-subtle">
                              Workshop
                            </span>
                          </p>
                          {w.instructions ? (
                            <p className="mt-0.5 line-clamp-2 text-[12px] text-foreground-muted">
                              {w.instructions}
                            </p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-foreground-subtle">
                            {w.due_date ? (
                              <span>Deadline {new Date(w.due_date).toLocaleDateString('sv-SE')}</span>
                            ) : null}
                            {resourceNames(w.expand?.collaborators) ? (
                              <span>Resurser: {resourceNames(w.expand?.collaborators)}</span>
                            ) : null}
                            {w.expand?.meeting ? (
                              <span>
                                📅 {w.expand.meeting.name} ·{' '}
                                {new Date(w.expand.meeting.starts_at).toLocaleString('sv-SE')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <WorkshopAssignmentStatusBadge status={w.status} />
                    </div>
                  </li>
                ))}

                {c.documents.map((d) => (
                  <li key={`d-${d.id}`} className="rounded-xl border border-default p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-subtle">
                          <Icon name="doc" size={15} />
                        </span>
                        <div>
                          <p className="text-[13.5px] font-medium text-foreground">
                            {d.expand?.document?.title || 'Dokument'}
                            <span className="ml-1.5 text-[11px] font-normal text-foreground-subtle">
                              Utbildningsdokument
                            </span>
                          </p>
                          {d.instructions ? (
                            <p className="mt-0.5 line-clamp-2 text-[12px] text-foreground-muted">
                              {d.instructions}
                            </p>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-foreground-subtle">
                            {d.due_date ? (
                              <span>Deadline {new Date(d.due_date).toLocaleDateString('sv-SE')}</span>
                            ) : null}
                            {resourceNames(d.expand?.collaborators) ? (
                              <span>Resurser: {resourceNames(d.expand?.collaborators)}</span>
                            ) : null}
                            {d.expand?.meeting ? (
                              <span>
                                📅 {d.expand.meeting.name} ·{' '}
                                {new Date(d.expand.meeting.starts_at).toLocaleString('sv-SE')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-movexum-pastell-bla px-2.5 py-0.5 text-xs font-medium text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">
                        Tilldelad
                      </span>
                    </div>
                  </li>
                ))}

                {c.activities.map((a) => (
                  <li key={`a-${a.id}`} className="rounded-xl border border-default p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-subtle">
                          <Icon name="calendar" size={15} />
                        </span>
                        <div>
                          <p className="text-[13.5px] font-medium text-foreground">
                            {a.title}
                            <span className="ml-1.5 text-[11px] font-normal text-foreground-subtle">
                              {activityTypeLabels[a.type]}
                            </span>
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-foreground-subtle">
                            {a.due_date ? (
                              <span>{new Date(a.due_date).toLocaleDateString('sv-SE')}</span>
                            ) : null}
                            {a.expand?.owner ? (
                              <span>
                                Ansvarig: {a.expand.owner.display_name || a.expand.owner.email}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-canvas-muted px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
                        {a.status === 'in_progress' ? 'Pågår' : 'Planerad'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </PageShell>
  );
}
