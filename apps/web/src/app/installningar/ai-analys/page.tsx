import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getBudgetStatus } from '@/lib/ai/budget.server';
import { AiBudgetForm } from '../AiBudgetForm';
import { requireSettingsUser, SettingsSectionPage } from '../shared';
import { loadUsageView } from './UsageView';
import { loadMiljoView } from './MiljoView';
import {
  AI_ANALYS_VIEWS,
  AI_ANALYS_VIEW_LABELS,
  aiAnalysHref,
  isAiAnalysView,
  type AiAnalysView
} from './paths';

export const dynamic = 'force-dynamic';

const INTRO: Record<AiAnalysView, string> = {
  kostnadstak:
    'Maximal AI-kostnad per kalendermånad för denna tenant. När taket nås pausas nya AI-körningar till nästa månad. Förbrukningen räknas över alla AI-ytor (chatt, agenter, schemalagda körningar, röst).',
  anvandning:
    'Hur AI:n används i din organisation: agentkörningar, tokens, kostnad, kvalitetsfeedback och adoption per period. Underlag för att justera promptar, modellval och utbildning.',
  miljo:
    'Uppskattad miljöpåverkan av AI-användningen — tokens, CO₂e och vatten per tenant, över alla tenants (systemvy).'
};

/**
 * Inställningar → AI-analys: kostnadstak, användning (f.d. /insights) och
 * miljöpåverkan (f.d. /admin/ai-miljo, admin-only) samlade under en sektion
 * med undervyer (§ 36.1). RBAC: admin/incubator_lead via requireSettingsUser;
 * miljövyn kräver dessutom admin (läser över tenant-gränser via superuser).
 */
export default async function AiAnalysPage({
  searchParams
}: {
  searchParams: Promise<{ vy?: string; range?: string }>;
}) {
  const user = await requireSettingsUser();
  const params = await searchParams;
  const view: AiAnalysView = isAiAnalysView(params.vy) ? params.vy : 'kostnadstak';
  const isAdmin = hasRole(user.roles, ['admin']);
  if (view === 'miljo' && !isAdmin) {
    redirect(aiAnalysHref('kostnadstak'));
  }

  const pb = await getServerPb();
  const visibleViews = AI_ANALYS_VIEWS.filter((v) => v !== 'miljo' || isAdmin);

  const subNav = (
    <nav aria-label="Vyer i AI-analys" className="flex flex-wrap items-center gap-2">
      {visibleViews.map((v) => (
        <Link
          key={v}
          href={aiAnalysHref(v, v === 'kostnadstak' ? undefined : params.range)}
          aria-current={v === view ? 'page' : undefined}
          className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
            v === view
              ? 'bg-brand text-brand-foreground'
              : 'border border-default text-foreground-muted hover:border-strong hover:text-foreground'
          }`}
        >
          {AI_ANALYS_VIEW_LABELS[v]}
        </Link>
      ))}
    </nav>
  );

  if (view === 'anvandning') {
    const usage = await loadUsageView({ user, pb, rangeParam: params.range });
    return (
      <SettingsSectionPage slug="ai-analys" roles={user.roles} intro={INTRO[view]} rightPanel={usage.rail}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {subNav}
          {usage.meta}
        </div>
        {usage.content}
      </SettingsSectionPage>
    );
  }

  if (view === 'miljo') {
    const miljo = await loadMiljoView({ rangeParam: params.range });
    return (
      <SettingsSectionPage slug="ai-analys" roles={user.roles} intro={INTRO[view]}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {subNav}
          {miljo.meta}
        </div>
        {miljo.content}
      </SettingsSectionPage>
    );
  }

  const budgetStatus = await getBudgetStatus(pb, user.tenant);
  return (
    <SettingsSectionPage slug="ai-analys" roles={user.roles} intro={INTRO[view]}>
      {subNav}
      <section className="max-w-2xl rounded-2xl border border-default bg-surface p-5">
        <AiBudgetForm
          tenantBudgetUsd={budgetStatus.tenantBudgetUsd}
          envDefaultUsd={budgetStatus.envDefaultUsd}
          effectiveUsd={budgetStatus.effectiveUsd}
          spentUsd={budgetStatus.spentUsd}
        />
      </section>
    </SettingsSectionPage>
  );
}
