import type { ReactNode } from 'react';
import { getServerPb } from '@/lib/auth.server';
import { escFilter } from '@/lib/pb-filter';
import { hasRole } from '@/lib/rbac';
import { Chip } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat, RailNote } from '@/components/PageRail';
import { getBudgetStatus } from '@/lib/ai/budget.server';
import { getInfraHealth, healthStateLabel, type HealthState } from '@/lib/health';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsSectionsFor } from '@/lib/settings-sections';
import { requireSettingsUser, SettingsCard, settingsTabsFor } from './shared';

export const dynamic = 'force-dynamic';

function healthIconTone(state: HealthState): 'success' | 'warning' | 'neutral' {
  if (state === 'up') return 'success';
  if (state === 'down' || state === 'unconfigured') return 'warning';
  return 'neutral';
}

const usd = (n: number) => `$${n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Inställningar — översikt. Varje område är ett kort som leder in i en egen
 * undersida; här visas bara en sammanfattning så sidan ger överblick i stället
 * för att lista allt innehåll direkt.
 */
export default async function InstallningarPage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();
  const isAdmin = hasRole(user.roles, ['admin']);
  const tenantFilter = pb.filter('tenant = {:t}', { t: user.tenant });

  // ── Sammanfattningar per kort (alla fail-soft) ─────────────────────────
  const [infra, budgetStatus] = await Promise.all([getInfraHealth(), getBudgetStatus(pb, user.tenant)]);

  let userCount = 0;
  let memberCount = 0;
  let unverifiedCount = 0;
  try {
    const res = await pb.collection('users').getList<{ roles?: unknown; verified?: boolean }>(1, 500, {
      filter: tenantFilter,
      fields: 'id,roles,verified'
    });
    userCount = res.totalItems;
    for (const u of res.items) {
      const roles = Array.isArray(u.roles) ? (u.roles as string[]) : [];
      if (roles.includes('startup_member')) memberCount += 1;
      if (u.verified === false) unverifiedCount += 1;
    }
  } catch (error) {
    console.error('[installningar] failed to count users', { tenant: user.tenant, error });
  }

  let memoryCount = 0;
  try {
    const mem = await pb.collection('agent_memory').getList(1, 1, { filter: tenantFilter, fields: 'id' });
    memoryCount = mem.totalItems;
  } catch {
    /* ignore */
  }

  let tenantCount = 1;
  let startupCount = 0;
  try {
    const filter = isAdmin ? '' : `id = "${escFilter(user.tenant)}"`;
    const t = await pb.collection('tenants').getList(1, 1, { filter, fields: 'id' });
    tenantCount = t.totalItems;
  } catch {
    /* ignore */
  }
  try {
    const s = await pb.collection('startups').getList(1, 1, { filter: tenantFilter, fields: 'id' });
    startupCount = s.totalItems;
  } catch {
    /* ignore */
  }

  const infraIssues = infra.filter((p) => p.state !== 'up').length;
  const hasLogo = Boolean(user.tenantLogoLightUrl || user.tenantLogoDarkUrl);
  const budgetPct =
    budgetStatus.effectiveUsd > 0
      ? Math.round((budgetStatus.spentUsd / budgetStatus.effectiveUsd) * 100)
      : null;

  // ── Kortinnehåll per sektion ───────────────────────────────────────────
  const cardProps: Record<
    string,
    { stat?: ReactNode; hint?: ReactNode; status?: ReactNode }
  > = {
    anvandare: {
      stat: `${userCount} användare`,
      hint: `${memberCount} bolagsmedlem${memberCount === 1 ? '' : 'mar'} · ${userCount - memberCount} personal & övriga · moduler per person`,
      status:
        unverifiedCount > 0 ? (
          <Chip variant="yellow" mono>
            {unverifiedCount} ej verifierad{unverifiedCount === 1 ? '' : 'e'}
          </Chip>
        ) : undefined
    },
    organisation: {
      stat: `${tenantCount} ${tenantCount === 1 ? 'tenant' : 'tenants'} · ${startupCount} bolag`,
      hint: infraIssues === 0 ? 'Alla tjänster i drift inom EU' : `${infraIssues} tjänst${infraIssues === 1 ? '' : 'er'} kräver uppmärksamhet`,
      status:
        infraIssues > 0 ? (
          <Chip variant="yellow" mono>
            Infra
          </Chip>
        ) : (
          <Chip variant="active" mono>
            Drift
          </Chip>
        )
    },
    'ai-kostnad': {
      stat: `${usd(budgetStatus.spentUsd)} förbrukat denna månad`,
      hint:
        budgetStatus.effectiveUsd > 0
          ? `Tak ${usd(budgetStatus.effectiveUsd)} · ${budgetPct} % använt`
          : 'Ingen kostnadsspärr aktiv',
      status:
        budgetPct !== null && budgetPct >= 80 ? (
          <Chip variant={budgetPct >= 95 ? 'copper' : 'yellow'} mono>
            {budgetPct} %
          </Chip>
        ) : undefined
    },
    'ai-minne': {
      stat: `${memoryCount} ${memoryCount === 1 ? 'notering' : 'noteringar'}`,
      hint: 'Generella regler chatten tar med i framtida samtal'
    },
    utseende: {
      stat: hasLogo ? 'Logotyp uppladdad' : 'Ingen egen logotyp',
      hint: hasLogo
        ? `${user.tenantLogoLightUrl ? 'Light' : ''}${user.tenantLogoLightUrl && user.tenantLogoDarkUrl ? ' · ' : ''}${user.tenantLogoDarkUrl ? 'Dark' : ''} mode`
        : 'Movexum-wordmarken används tills vidare'
    }
  };

  const visibleSections = settingsSectionsFor(user.roles);

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Användare" value={userCount} />
          <RailStat label="Bolag" value={startupCount} />
          <RailStat label="Personal" value={userCount - memberCount} hint="staff & övriga" />
          <RailStat label="AI-minne" value={memoryCount} hint="inlärda noteringar" />
        </div>
      </RailSection>
      <RailSection label="Infra-status">
        {infra.map((p) => (
          <RailItem
            key={p.name}
            icon={p.state === 'up' ? 'shield' : 'alert'}
            iconTone={healthIconTone(p.state)}
            title={p.name}
            meta={p.detail ? `${healthStateLabel(p.state)} · ${p.detail}` : healthStateLabel(p.state)}
          />
        ))}
        {infraIssues === 0 && <RailNote>Alla tjänster i drift inom EU.</RailNote>}
      </RailSection>
    </>
  );

  return (
    <PageShell title="Inställningar" tabs={settingsTabsFor(user.roles)} rightPanel={rail}>
      <div className="space-y-8 py-6">
        <p className="max-w-2xl text-[13.5px] leading-relaxed text-foreground-muted">
          Styr hur Movexum OS ser ut och beter sig för din organisation. Välj ett område
          nedan — varje kort öppnar en egen sida där du ser detaljerna och gör ändringar.
          Ändringar gäller hela tenanten direkt.
        </p>

        {SETTINGS_GROUPS.map((group) => {
          const sections = visibleSections.filter((s) => s.group === group.id);
          if (sections.length === 0) return null;
          return (
            <div key={group.id} className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="font-heading text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  {group.label}
                </h2>
                <div className="h-px flex-1 bg-[var(--mx-line-soft)]" />
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sections.map((s) => (
                  <SettingsCard key={s.id} section={s} {...cardProps[s.id]} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Osynliga sektioner (skulle bara gälla om rollkrav skiljer sig) */}
        {visibleSections.length < SETTINGS_SECTIONS.length && (
          <p className="text-[12px] text-foreground-subtle">
            Vissa områden visas bara för administratörer.
          </p>
        )}
      </div>
    </PageShell>
  );
}
