import { getServerPb } from '@/lib/auth.server';
import { getBudgetStatus } from '@/lib/ai/budget.server';
import { AiBudgetForm } from '../AiBudgetForm';
import { requireSettingsUser, SettingsSectionPage } from '../shared';

export const dynamic = 'force-dynamic';

export default async function AiKostnadPage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();
  const budgetStatus = await getBudgetStatus(pb, user.tenant);

  return (
    <SettingsSectionPage
      slug="ai-kostnad"
      roles={user.roles}
      intro="Maximal AI-kostnad per kalendermånad för denna tenant. När taket nås pausas nya AI-körningar till nästa månad. Förbrukningen räknas över alla AI-ytor (chatt, agenter, schemalagda körningar, röst)."
    >
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
