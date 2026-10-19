import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listConnectedRegistries, listScreenableStartups } from '@/lib/excellence/data.server';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import { findOpenScreeningCase, listScreeningCases, openCasesByOrgNr } from '@/lib/excellence/cases.server';
import { loadCaseAssessment } from '@/lib/excellence/compute.server';
import { isScreeningCaseId } from '@/lib/excellence/cases';
import { ExcellenceWorkspace, type CaseInfo } from './ExcellenceWorkspace';
import { CaseList } from './CaseList';
import { HowItWorks } from './HowItWorks';

export const dynamic = 'force-dynamic';

// Bedömning excellens (CLAUDE.md § 51): förscreening av ett bolag och dess
// koncern mot art. 22 GBER / de minimis och Vinnovas målgrupp, med färsk data
// från bolagsregistret (Roaring) eller det som redan är sparat. Deterministiskt
// underlag — ingen AI, inget beslut; bedömningen arkiveras som PDF i Filer (§ 51.3).
//
// Ärenden (§ 51.10): sidan listar aktuella ärenden; "Skapa ärende" (uppe till
// höger) öppnar bolagsvalet, `?arende=<id>` fortsätter ett sparat ärende på
// dess underlag utan nya registeranrop.

const FLASH: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  klarmarkerat: { tone: 'ok', text: 'Ärendet är klarmarkerat — slutbedömningen är sparad som PDF och ärendet har flyttats till Avslutade.' },
  arende: { tone: 'warn', text: 'Ärendet hittades inte.' },
  behorighet: { tone: 'warn', text: 'Du har inte behörighet att ändra ärendet.' },
  status: { tone: 'warn', text: 'Ärendet kunde inte uppdateras just nu — försök igen.' },
  pdf: { tone: 'warn', text: 'Slutbedömningens PDF kunde inte sparas i Filer — ärendet är inte klarmarkerat. Försök igen.' },
  underlag: { tone: 'warn', text: 'Ärendet saknar underlag — kör bedömningen innan det klarmarkeras.' }
};

function Flash({ code }: { code?: string }) {
  const f = code ? FLASH[code] : undefined;
  if (!f) return null;
  return (
    <p
      className={`rounded-xl px-3 py-2 text-[12.5px] ${
        f.tone === 'ok'
          ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
          : 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange'
      }`}
    >
      {f.text}
    </p>
  );
}

const PRIMARY_BTN =
  'inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover';
const SECONDARY_BTN =
  'inline-flex items-center justify-center rounded-full border border-strong px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle';

export default async function BedomningExcellensPage({
  searchParams
}: {
  searchParams: Promise<{ startup?: string; arende?: string; ny?: string; visa?: string; klarmarkerat?: string; fel?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules)) redirect('/hem');
  const sp = await searchParams;
  const initialStartupId = sp.startup && /^[a-z0-9]{1,30}$/i.test(sp.startup) ? sp.startup : undefined;
  const caseId = isScreeningCaseId(sp.arende) ? sp.arende : undefined;
  // Färska uppslag debiteras per anrop — samma krets som "Testa mot org-nr".
  const canLookup = hasRole(user.roles, ['admin', 'incubator_lead']);
  const canManage = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const pb = await getServerPb();
  const viewer = { tenant: user.tenant, roles: user.roles };
  const flashCode = sp.klarmarkerat === '1' ? 'klarmarkerat' : sp.fel;

  const shell = (actions: React.ReactNode, body: React.ReactNode) => (
    <PageShell
      title="Bedömning excellens"
      meta={<span className="text-sm text-foreground-subtle">Art. 22 GBER · de minimis · Vinnovas målgrupp — hela koncernen</span>}
      actions={actions}
    >
      <div className="space-y-5">
        <Flash code={flashCode} />
        <HowItWorks />
        {body}
      </div>
    </PageShell>
  );
  const createButton = (
    <Link href="/bedomning-excellens?ny=1" className={PRIMARY_BTN}>
      Skapa ärende
    </Link>
  );

  // Listan (standard): aktuella ärenden, eller avslutade med ?visa=avslutade.
  if (!caseId && sp.ny !== '1' && !initialStartupId) {
    const view = sp.visa === 'avslutade' ? 'done' : 'open';
    const [current, other] = await Promise.all([
      listScreeningCases(pb, viewer, view),
      listScreeningCases(pb, viewer, view === 'open' ? 'done' : 'open', 1)
    ]);
    const openCount = view === 'open' ? (current.error ? null : current.total) : other.error ? null : other.total;
    const doneCount = view === 'done' ? (current.error ? null : current.total) : other.error ? null : other.total;
    return shell(
      canManage ? createButton : null,
      <CaseList view={view} cases={current.cases} openCount={openCount} doneCount={doneCount} error={current.error} canManage={canManage} />
    );
  }

  // Från bolagskortet: finns ett pågående ärende för bolaget fortsätter vi i det.
  if (!caseId && initialStartupId) {
    const open = await findOpenScreeningCase(pb, viewer, { startupId: initialStartupId });
    if (open) redirect(`/bedomning-excellens?arende=${open.id}`);
  }

  let initialCase: CaseInfo | undefined;
  let initialAssessment;
  if (caseId) {
    const loaded = await loadCaseAssessment(
      pb,
      { id: user.id, tenant: user.tenant, roles: user.roles, linkedStartups: user.linkedStartups, name: user.name },
      caseId
    );
    if (!loaded) redirect('/bedomning-excellens?fel=arende');
    const { row } = loaded!;
    initialCase = {
      id: row.id,
      status: row.status,
      name: row.subject_name,
      orgNr: row.org_nr,
      startupId: row.startup,
      lastAssessedAt: row.last_assessed_at,
      lastAssessedByName: row.last_assessed_by_name,
      createdByName: row.created_by_name,
      completedAt: row.completed_at,
      completedByName: row.completed_by_name
    };
    initialAssessment = loaded!.assessment;
  }

  const [startups, registries, coaches, openByOrg] = await Promise.all([
    listScreenableStartups(pb, user.tenant),
    canLookup ? listConnectedRegistries(pb, user.tenant) : Promise.resolve([]),
    // Kollegor en begäran om komplettering kan gå till (§ 51.6) — aldrig den inloggade själv.
    listAssignableResourcesForTenant(pb, user.tenant).then((rows) => rows.filter((r) => r.id !== user.id)),
    caseId ? Promise.resolve({}) : openCasesByOrgNr(pb, viewer)
  ]);
  const senderName = user.name && !user.name.includes('@') ? user.name : undefined;

  return shell(
    <>
      <Link href="/bedomning-excellens" className={SECONDARY_BTN}>
        Alla ärenden
      </Link>
      {canManage && caseId && createButton}
    </>,
    <ExcellenceWorkspace
      startups={startups}
      registries={registries}
      canLookup={canLookup}
      canManage={canManage}
      initialStartupId={initialStartupId}
      initialCase={initialCase}
      initialAssessment={initialAssessment}
      openCasesByOrg={openByOrg}
      coaches={coaches}
      senderName={senderName}
    />
  );
}
