import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  SCREENING_REQUEST_RECIPIENT_LABEL,
  SCREENING_REQUEST_STATUS_LABEL,
  formatStockholmDateTime,
  isPureStartupMember
} from '@platform/shared';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { getScreeningRequest } from '@/lib/excellence/requests.server';
import { loadPlatformStartupFacts } from '@/lib/excellence/data.server';
import { closeScreeningRequestAction } from '@/lib/actions/screening-requests';
import { recomputeLatestScreeningAction } from '@/lib/actions/excellence';
import { ScreeningRequestAnswerForm } from '@/components/excellence/ScreeningRequestAnswerForm';

export const dynamic = 'force-dynamic';

// Svarssidan för en begäran om komplettering (CLAUDE.md § 51.6). Nås av
// Movexum-personal (coach, controller, ledning, observer läser) och av en
// bolagsmedlem länkad till bolaget NÄR förfrågan är ställd till bolaget.
// RLS gör samma avgränsning (list/view); sidan verifierar i koden.

export default async function KompletteringPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const pb = await getServerPb();
  // Läsvägen prövar behörigheten i koden (canViewScreeningRequest, samma
  // villkor som RLS) även när raden lästs med superuser-reserven (§ 21.3) —
  // null betyder "finns inte eller får inte ses".
  const request = await getScreeningRequest(pb, { tenant: user.tenant, roles: user.roles, linkedStartups: user.linkedStartups }, id);
  if (!request) {
    if (isPureStartupMember(user.roles)) redirect('/min-oversikt');
    notFound();
  }

  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isObserver = hasRole(user.roles, ['observer']);
  const isLinkedMember = hasRole(user.roles, ['startup_member']) && user.linkedStartups.includes(request.startup);
  const memberMayAnswer = isLinkedMember && request.recipient_kind === 'startup';
  if (!isStaff && !isObserver && !memberMayAnswer) redirect(isPureStartupMember(user.roles) ? '/min-oversikt' : '/hem');

  const canAnswer = (isStaff || memberMayAnswer) && request.status !== 'closed';
  const canClose = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']) && request.status !== 'closed';
  const viewer: 'coach' | 'startup' = isStaff || isObserver ? 'coach' : 'startup';

  // Förifyll grundarteamet ur bolagets sparade svar (annars teamet på
  // bolagskortet) — läses med användarens token, fail-soft.
  const platform = await loadPlatformStartupFacts(pb, user.tenant, request.startup);
  const prefill = platform
    ? {
        founders: platform.facts.founders ?? platform.founders.map((f) => ({ name: f.name, equity_pct: f.equity_pct })),
        maturity_phase: platform.facts.maturity_phase,
        research_spinoff: platform.facts.research_spinoff
      }
    : undefined;

  const answered = request.items.filter((i) => i.status === 'answered').length;
  const backHref = viewer === 'startup' ? '/min-oversikt' : `/startups/${request.startup}#statsstod`;

  return (
    <PageShell
      title="Begäran om komplettering"
      meta={
        <span className="text-sm text-foreground-subtle">
          {request.startup_name ?? 'Bolaget'} · till {SCREENING_REQUEST_RECIPIENT_LABEL[request.recipient_kind].toLowerCase()}
          {request.recipient_name ? ` (${request.recipient_name})` : ''}
        </span>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-foreground-muted">
          <Link href={backHref} className="font-semibold text-link hover:underline">
            ← {viewer === 'startup' ? 'Mitt bolag' : 'Bolagskortet'}
          </Link>
          <span>
            Status: <strong className="text-foreground">{SCREENING_REQUEST_STATUS_LABEL[request.status]}</strong> ({answered} av {request.items.length} besvarade)
          </span>
          {request.requested_by_name && <span>Skickad av {request.requested_by_name}</span>}
          {request.created && <span className="mx-tnum">{formatStockholmDateTime(request.created)}</span>}
          {request.due_at && <span className="mx-tnum">Svar önskas senast {request.due_at.slice(0, 10)}</span>}
        </div>

        <p className="text-sm text-foreground-muted">
          {viewer === 'startup'
            ? 'Movexums controller behöver de här uppgifterna inför bedömningen av statsstöd (art. 22 GBER / de minimis) och Vinnovas målgrupp. Svara på det ni kan — det går att spara delvis och fortsätta senare. Skriv inga personnummer.'
            : 'Punkterna är de som bedömningen inte kunde avgöra ur bolagsregistret eller plattformen. Svaren sparas i bolagets manuella svar och vägs in nästa gång bedömningen räknas om.'}
        </p>
        {request.message && (
          <blockquote className="rounded-2xl border-l-4 border-brand bg-canvas-subtle px-4 py-3 text-[13px] text-foreground whitespace-pre-line">{request.message}</blockquote>
        )}

        <ScreeningRequestAnswerForm requestId={request.id} items={request.items} prefill={prefill} viewer={viewer} readOnly={!canAnswer} />

        {canClose && (
          <form action={closeScreeningRequestAction} className="flex flex-wrap items-center gap-3 border-t border-default pt-4">
            <input type="hidden" name="request_id" value={request.id} />
            <input type="hidden" name="startup_id" value={request.startup} />
            <button type="submit" className="rounded-full border border-strong px-4 py-2 text-sm font-semibold text-foreground hover:bg-canvas-subtle">
              Avsluta förfrågan
            </button>
            <span className="text-[12px] text-foreground-muted">Avslutad = inga fler svar tas emot. Svaren som redan lämnats finns kvar på bolagskortet.</span>
          </form>
        )}
        {canClose && (
          <form action={recomputeLatestScreeningAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="startup_id" value={request.startup} />
            <input type="hidden" name="back" value={`/startups/${request.startup}`} />
            <button type="submit" className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-hover">
              Räkna om med svaren och spara ny PDF
            </button>
            <span className="text-[12px] text-foreground-muted">
              Senaste bedömningens underlag + svaren här ⇒ ny körning på bolagskortet och PDF i dina Filer. Inga nya anrop hos leverantören.
            </span>
            <Link href={`/bedomning-excellens?startup=${request.startup}`} className="text-[12px] font-semibold text-link hover:underline">
              Ny bedömning med färska uppslag →
            </Link>
          </form>
        )}
      </div>
    </PageShell>
  );
}
