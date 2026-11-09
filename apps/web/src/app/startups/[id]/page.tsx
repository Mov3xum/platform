import Link from 'next/link';
import { markdownToHtml } from '@/lib/safe-html';
import { NoteForm } from '@/components/NoteForm';
import { NoteItem } from '@/components/NoteItem';
import { Icon } from '@/components/proto';
import { IrlRadar } from '@/components/irl/IrlRadar';
import { irlLevelTone } from '@/components/irl/tone';
import { loadIrlAssessments } from '@/lib/irl/data.server';
import { activityTypeLabels, type ActivityType } from '@/lib/labels';
import { irlAxis, irlNextStep, summarizeIrl } from '@platform/shared';
import { loadStartupPage } from './_shared/context';
import { loadStartupAssignments } from './_shared/work';
import { HashRedirect } from './_shared/HashRedirect';
import { Empty, PillLink, Section, TabPage, formatDate, relDays, stripHtml } from './_shared/ui';

interface NoteRecord {
  id: string;
  body: string;
  author: string;
  confidential: boolean;
  created: string;
  expand?: { author?: { id: string; display_name?: string } };
}

interface ActivityRecord {
  id: string;
  title?: string;
  description?: string;
  type?: ActivityType;
  kind?: string;
  created: string;
}

interface AgreementRecord {
  id: string;
  title: string;
  status: string;
  requires_company_signature?: boolean;
  requires_movexum_signature?: boolean;
  company_signed_at?: string;
  movexum_signed_at?: string;
}

const NOTES_PREVIEW = 5;

const activityKindLabels: Record<string, string> = {
  tool_run: 'AI-körning',
  integration_sync: 'Synk',
  education_document: 'Utbildning',
  agreement: 'Avtal',
  onboarding: 'Onboarding',
  meeting: 'Möte',
  mission: 'Team',
  support_check: 'Stödcheck',
  workshop_assignment: 'Workshop',
  workshop_run: 'Workshop'
};

/**
 * Bolagskortets översikt — det viktigaste på en skärm: läget och nästa steg,
 * KTH IRL-profilen, vad som väntar, anteckningar och senaste händelser.
 * Allt annat ligger i flikarna (Utveckling, Ekonomi, Avtal & dokument,
 * Team & nätverk) så sidan inte längre kräver långa scrollningar.
 */
export default async function StartupOverviewPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const showAllNotes = sp.anteckningar === 'alla';
  const { user, startup, pb, flags } = await loadStartupPage(id);
  const byStartup = pb.filter('startup = {:startup}', { startup: id });

  const [notesRes, activitiesRes, agreementsRes, tasksRes, irl, work] = await Promise.all([
    pb
      .collection('notes')
      .getList<NoteRecord>(1, showAllNotes ? 50 : NOTES_PREVIEW, {
        filter: byStartup,
        sort: '-created',
        expand: 'author',
        fields: 'id,body,author,confidential,created,expand.author.id,expand.author.display_name'
      })
      .then((r) => ({ ok: true as const, r }), () => ({ ok: false as const })),
    pb
      .collection('activities')
      .getList<ActivityRecord>(1, 6, { filter: byStartup, sort: '-created', fields: 'id,title,description,type,kind,created' })
      .then((r) => ({ ok: true as const, r }), () => ({ ok: false as const })),
    pb
      .collection('agreements')
      .getList<AgreementRecord>(1, 50, {
        filter: byStartup,
        fields: 'id,title,status,requires_company_signature,requires_movexum_signature,company_signed_at,movexum_signed_at'
      })
      .then((r) => ({ ok: true as const, r }), () => ({ ok: false as const })),
    pb
      .collection('tasks')
      .getList(1, 1, {
        filter: pb.filter('startup = {:startup} && tenant = {:tenant} && status != "done" && status != "cancelled"', {
          startup: id,
          tenant: user.tenant
        })
      })
      .then((r) => r.totalItems, () => null),
    flags.isStaffOrObserver ? loadIrlAssessments(pb, user.tenant, id, 2) : Promise.resolve(null),
    loadStartupAssignments(pb, user.tenant, id)
  ]);

  const notes = notesRes.ok ? notesRes.r : null;
  const activities = activitiesRes.ok ? activitiesRes.r.items : [];
  const agreements = agreementsRes.ok ? agreementsRes.r.items : [];
  const awaitingSignature = agreements.filter((a) => {
    // Bara avtal som faktiskt skickats för signering (äldre rader saknar flaggorna).
    if (a.status !== 'sent' && a.status !== 'partially_signed') return false;
    const needCompany = a.requires_company_signature === true && !a.company_signed_at;
    const needMovexum = a.requires_movexum_signature !== false && !a.movexum_signed_at;
    return needCompany || needMovexum;
  });
  const overdue = work.pending.filter((w) => w.overdue).length;
  const loadFailed = !notesRes.ok || !activitiesRes.ok || work.failed;

  const latestIrl = irl?.assessments[0] ?? null;
  const previousIrl = irl?.assessments[1] ?? null;
  const irlSummary = latestIrl ? summarizeIrl(latestIrl.profile) : null;
  const weakest = irlSummary?.weakest[0];

  const facts: Array<[string, React.ReactNode]> = (
    [
      ['Org.nr', startup.org_nr ? <span className="mx-tnum">{startup.org_nr}</span> : null],
      ['Bolagsform', startup.bolagsform ? startup.bolagsform.replace(/_/g, ' ') : null],
      ['Ort', startup.city || startup.kommun || null],
      ['Bransch', startup.industri || null],
      ['Idé', startup.idea_name || null],
      ['Intag', startup.intagsdatum ? formatDate(startup.intagsdatum) : null],
      ['Registrerat', startup.company_registered_at ? formatDate(startup.company_registered_at) : null],
      ['Inflöde', startup.inflow_source || null],
      [
        'Webb',
        startup.website ? (
          <a
            href={/^https?:\/\//i.test(startup.website) ? startup.website : `https://${startup.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link hover:underline"
          >
            {startup.website.replace(/^https?:\/\//i, '')}
          </a>
        ) : null
      ]
    ] as Array<[string, React.ReactNode]>
  ).filter(([, v]) => v !== null && v !== '');

  const tags = (startup.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <TabPage>
      <HashRedirect startupId={id} />
      {loadFailed ? (
        <p className="rounded-2xl border border-default bg-surface p-4 text-sm text-foreground-muted">
          Vissa delar av översikten kunde inte laddas just nu.
        </p>
      ) : null}

      {/* Läget + IRL */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground-subtle">Nästa steg</p>
          <p className="mt-1 font-heading text-lg font-semibold text-foreground">
            {startup.next_step || <span className="font-normal text-foreground-subtle">Inget nästa steg satt.</span>}
          </p>

          {startup.description ? (
            <div
              className="prose mt-5 max-w-none text-sm text-foreground-muted dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(startup.description) }}
            />
          ) : (
            <p className="mt-5 text-sm text-foreground-subtle">Ingen beskrivning än.</p>
          )}
          {tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag} className="rounded-full bg-canvas-subtle px-3 py-1 text-xs font-medium text-foreground-muted">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          {facts.length > 0 ? (
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-default pt-5 text-sm sm:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-subtle">{label}</dt>
                  <dd className="mt-0.5 truncate text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        <section
          id="irl"
          className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">Innovation Readiness Level</h2>
              <p className="text-xs text-foreground-subtle">KTH IRL · sex axlar, 1–9</p>
            </div>
            {irlSummary?.average != null ? (
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold mx-tnum ${irlLevelTone(Math.round(irlSummary.average))}`}>
                {irlSummary.average.toLocaleString('sv-SE')}
              </span>
            ) : null}
          </div>
          {latestIrl ? (
            <>
              <div className="mt-2">
                <IrlRadar profile={latestIrl.profile} previous={previousIrl?.profile} size="sm" />
              </div>
              {weakest ? (
                <p className="mt-2 text-xs text-foreground-muted">
                  <span className="font-semibold text-foreground">Svagast: {irlAxis(weakest).label}</span>
                  {irlNextStep(weakest, latestIrl.profile[weakest]) ? (
                    <> — nästa nivå: {irlNextStep(weakest, latestIrl.profile[weakest])}</>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-2 text-[11px] text-foreground-subtle">
                Bedömd {formatDate(latestIrl.assessedAt)}
                {latestIrl.assessorName ? ` av ${latestIrl.assessorName}` : ''}
              </p>
            </>
          ) : (
            <div className="mt-4 text-sm text-foreground-muted">
              {flags.isStaffOrObserver ? (
                irl?.error ? (
                  <p>{irl.error}</p>
                ) : (
                  <p>Ingen IRL-bedömning än.{startup.irl_level ? ` Sammanfattande nivå på bolagskortet: ${startup.irl_level}.` : ''}</p>
                )
              ) : startup.irl_level ? (
                <p>
                  IRL-nivå <span className="font-semibold text-foreground">{startup.irl_level}</span> av 9.
                </p>
              ) : (
                <p>Er coach gör IRL-bedömningen tillsammans med er.</p>
              )}
            </div>
          )}
          {flags.isStaffOrObserver ? (
            <Link
              href={`/startups/${id}/utveckling#irl`}
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline"
            >
              {latestIrl ? 'Öppna IRL' : flags.isStaff ? 'Gör en bedömning' : 'Öppna IRL'} →
            </Link>
          ) : null}
        </section>
      </div>

      {/* Att hålla koll på */}
      <Section
        id="att-gora"
        title="Att hålla koll på"
        action={<PillLink href={`/startups/${id}/utveckling#arbete`}>Allt arbete</PillLink>}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Signal label="Väntar på bolaget" value={work.pending.length} href={`/startups/${id}/utveckling#arbete`} />
          <Signal label="Försenat" value={overdue} href={`/startups/${id}/utveckling#arbete`} warn={overdue > 0} />
          <Signal
            label="Avtal att signera"
            value={agreementsRes.ok ? awaitingSignature.length : null}
            href={`/startups/${id}/dokument#agreements`}
            warn={awaitingSignature.length > 0}
          />
          <Signal label="Öppna uppgifter" value={tasksRes} href={`/startups/${id}/aktiviteter`} />
        </div>
        {work.pending.length === 0 ? (
          <Empty>Inget väntar — bolaget är ikapp med allt som tilldelats.</Empty>
        ) : (
          <ul className="divide-y divide-default">
            {work.pending.slice(0, 6).map((card) => (
              <li key={`${card.kind}-${card.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={card.href} className="min-w-0 truncate text-sm font-medium text-foreground hover:text-brand hover:underline">
                  {card.title}
                </Link>
                <span
                  className={`shrink-0 text-xs ${card.overdue ? 'font-semibold text-movexum-orange' : 'text-foreground-subtle'}`}
                >
                  {card.dateLabel || card.statusLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Anteckningar + senaste händelser */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section
            id="notes"
            title="Anteckningar"
            action={
              notes && notes.totalItems > NOTES_PREVIEW ? (
                <PillLink href={showAllNotes ? `/startups/${id}#notes` : `/startups/${id}?anteckningar=alla#notes`}>
                  {showAllNotes ? 'Visa färre' : `Visa alla (${notes.totalItems})`}
                </PillLink>
              ) : null
            }
          >
            <div className="mb-5 rounded-2xl border border-default bg-canvas-subtle/50 p-4">
              <NoteForm startupId={id} />
            </div>
            {!notes ? (
              <Empty>Anteckningarna kunde inte läsas just nu.</Empty>
            ) : notes.items.length === 0 ? (
              <Empty>Inga anteckningar än.</Empty>
            ) : (
              <ul className="space-y-3">
                {notes.items.map((n) => (
                  <li key={n.id} className="rounded-2xl border border-default p-4">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-foreground-subtle">
                      <span>
                        {n.expand?.author?.display_name || 'Okänd'} · {relDays(n.created)}
                      </span>
                      {n.confidential ? (
                        <span className="rounded-full bg-movexum-pastell-gul px-2 py-0.5 font-medium text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
                          Konfidentiell
                        </span>
                      ) : null}
                    </div>
                    <NoteItem noteId={n.id} body={n.body} confidential={n.confidential} isAuthor={n.author === user.id} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="lg:col-span-2">
          <Section id="activities" title="Senaste händelser" action={<PillLink href={`/startups/${id}/logg`}>Hela loggen</PillLink>}>
            {activities.length === 0 ? (
              <Empty>Inga händelser registrerade.</Empty>
            ) : (
              <ol className="relative space-y-4 border-l border-default pl-4">
                {activities.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand" aria-hidden />
                    <p className="text-sm font-medium text-foreground">
                      {a.title || stripHtml(a.description || '').slice(0, 80) || 'Aktivitet'}
                    </p>
                    <p className="text-xs text-foreground-subtle">
                      {(a.kind && activityKindLabels[a.kind]) || (a.type ? activityTypeLabels[a.type] : 'Aktivitet')} ·{' '}
                      {relDays(a.created)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <div className="mt-6 rounded-3xl border border-default bg-canvas-subtle/40 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground-subtle">Verktyg för bolaget</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <PillLink href={`/toolbox?startup=${id}&category=ai_per_startup`}>
                <Icon name="sparkle" size={13} /> AI per bolag
              </PillLink>
              <PillLink href={`/toolbox?startup=${id}&category=template`}>Mallar</PillLink>
              <PillLink href={`/toolbox?startup=${id}&category=checklist`}>Checklistor</PillLink>
            </div>
          </div>
        </div>
      </div>
    </TabPage>
  );
}

function Signal({ label, value, href, warn }: { label: string; value: number | null; href: string; warn?: boolean }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-0.5 rounded-2xl border border-default bg-canvas-subtle/40 px-4 py-3 transition hover:border-brand/40 hover:bg-canvas-subtle"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">{label}</span>
      <span className={`font-heading text-2xl font-semibold mx-tnum ${warn ? 'text-movexum-orange' : 'text-foreground'}`}>
        {value ?? '–'}
      </span>
    </Link>
  );
}
