import Link from 'next/link';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { Icon } from '@/components/proto';
import { resolveRegistryPricing } from '@/lib/integrations/company-registry/pricing.server';
import type { RegistryPricing } from '@/lib/integrations/company-registry/pricing';
import { getHandler, listCompanyRegistrySlugs } from '@/lib/integrations/registry';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';
import { canManageStartupDeMinimis } from '@/lib/de-minimis/data';
import { RegistrySyncButton } from '../RegistrySyncButton';
import { DeMinimisSection } from '../DeMinimisSection';
import { StartupSupportChecksSection } from '../StartupSupportChecksSection';
import { StartupScreeningSection } from '../StartupScreeningSection';
import { StartupProcurementsSection } from '../StartupProcurementsSection';
import { loadStartupPage } from '../_shared/context';
import type { FinancialsSource } from '../_shared/types';
import { Empty, PillLink, Section, SectionNav, SourceBadge, TabPage, formatDate, formatSek } from '../_shared/ui';

interface FinancialsRow {
  id: string;
  year: number;
  employees?: number;
  revenue_sek?: number;
  personnel_cost_sek?: number;
  corporate_tax_sek?: number;
  balance_sheet_sek?: number;
  equity_sek?: number;
  /** Beslutad utdelning (§ 51) — bara meningsfull när `dividend_reported` är sant. */
  dividend_sek?: number;
  dividend_reported?: boolean;
  source: FinancialsSource;
}

// Ägarbild (§ 11.8). Fysiska personer bär aldrig namn.
interface OwnershipRow {
  id: string;
  direction: 'owner' | 'holding';
  owner_kind: 'company' | 'person' | 'public_body' | 'investor' | 'other';
  name?: string;
  org_nr?: string;
  capital_pct?: number;
  voting_pct?: number;
  pct_min?: number;
  pct_max?: number;
  control_basis?: string;
  indirect?: boolean;
  source: string;
}

interface ConnectedRegistryProvider {
  slug: string;
  name: string;
  parts: RegistryPartId[];
  partEndpoints?: Partial<Record<RegistryPartId, string>>;
  pricing: RegistryPricing;
}

interface EngagementRecord {
  id: string;
  engagement_type: string;
  started_at?: string;
  amount_sek?: number;
  expand?: { partner?: { id: string; name: string } };
}

interface CapitalRoundRecord {
  id: string;
  type: string;
  source: string;
  amount_sek: number;
  received_at: string;
}

const capitalTypeLabels: Record<string, string> = {
  grant: 'Bidrag',
  equity: 'Eget kapital (investering)',
  loan: 'Lån',
  soft_funding: 'Mjuk finansiering',
  convertible: 'Konvertibel',
  other: 'Övrigt'
};

/**
 * Flik "Ekonomi & statsstöd": bokslut och ägarbild från bolagsregister,
 * kapital, de minimis, stödcheckar, bedömning excellens och upphandlingar.
 */
export default async function StartupEconomyPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const screeningFeedback = typeof sp.bedomning === 'string' && /^[a-z]{1,20}$/.test(sp.bedomning) ? sp.bedomning : undefined;
  const { user, startup, pb, flags } = await loadStartupPage(id);
  const byStartup = pb.filter('startup = {:startup}', { startup: id });
  const canSyncRegistry = hasRole(user.roles, ['admin', 'incubator_lead']);
  const canAssess = canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules);

  const [financials, ownership, engagements, capital, registries] = await Promise.all([
    pb
      .collection('startup_financials')
      .getList<FinancialsRow>(1, 10, { filter: byStartup, sort: '-year' })
      .then((r) => r.items, () => null),
    flags.isStaffOrObserver
      ? pb
          .collection('startup_ownership')
          .getList<OwnershipRow>(1, 50, {
            filter: pb.filter('startup = {:startup} && tenant = {:tenant}', { startup: id, tenant: user.tenant }),
            sort: 'direction,-capital_pct'
          })
          .then((r) => r.items, () => [] as OwnershipRow[])
      : Promise.resolve([] as OwnershipRow[]),
    pb
      .collection('partner_engagements')
      .getList<EngagementRecord>(1, 50, { filter: byStartup, sort: '-started_at', expand: 'partner' })
      .then((r) => r.items, () => [] as EngagementRecord[]),
    pb
      .collection('capital_rounds')
      .getList<CapitalRoundRecord>(1, 50, {
        filter: byStartup,
        sort: '-received_at',
        // notes är strategiska (§ 15.3) — visas inte här.
        fields: 'id,type,source,amount_sek,received_at'
      })
      .then((r) => r.items, () => [] as CapitalRoundRecord[]),
    canSyncRegistry ? loadConnectedRegistries(pb, user.tenant) : Promise.resolve([] as ConnectedRegistryProvider[])
  ]);

  const capitalTotal = capital.reduce((s, c) => s + (c.amount_sek || 0), 0);

  return (
    <TabPage>
      <SectionNav
        items={[
          { href: '#financials', label: 'Bokslut', count: financials?.length },
          ...(flags.isStaffOrObserver ? [{ href: '#agarbild', label: 'Ägarbild', count: ownership.length }] : []),
          { href: '#kapital', label: 'Kapital', count: capital.length + engagements.length },
          { href: '#de-minimis', label: 'De minimis' },
          { href: '#stodcheckar', label: 'Stöd & checkar' },
          ...(flags.isStaffOrObserver
            ? [
                { href: '#statsstod', label: 'Statsstöd & Vinnova' },
                { href: '#upphandlingar', label: 'Upphandlingar' }
              ]
            : [])
        ]}
      />

      <Section
        id="financials"
        title="Finansiell historik"
        description="Årsvisa nyckeltal från årsredovisningar och manuella inlägg. Källa visas per rad."
        action={
          canSyncRegistry && startup.org_nr && registries.length > 0 ? (
            registries.map((p) => (
              <RegistrySyncButton
                key={p.slug}
                startupId={id}
                providerSlug={p.slug}
                providerName={p.name}
                registryParts={p.parts}
                partEndpoints={p.partEndpoints}
                pricing={p.pricing}
                pricingHref={`/integrationer/${p.slug}#kostnad`}
              />
            ))
          ) : canSyncRegistry && startup.org_nr ? (
            <Link href="/integrationer" className="text-xs text-link hover:underline">
              Anslut ett bolagsregister för att synka →
            </Link>
          ) : null
        }
      >
        {!startup.org_nr ? (
          <Empty>Fyll i organisationsnummer under ”Redigera” för att kunna synka från bolagsregister.</Empty>
        ) : financials === null ? (
          <Empty>Bokslutsdata kunde inte läsas just nu.</Empty>
        ) : financials.length === 0 ? (
          <Empty>Inga årsrader registrerade än.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-default">
            <table className="w-full text-sm">
              <thead className="bg-canvas-subtle text-left text-xs uppercase tracking-wider text-foreground-subtle">
                <tr>
                  {['År', 'Omsättning', 'Anställda', 'Balansomslutning', 'Eget kapital', 'Utdelning', 'Personalkostnad', 'Bolagsskatt', 'Källa'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {financials.map((row) => (
                  <tr key={row.id} className="border-t border-default">
                    <td className="px-3 py-2 font-medium text-foreground">{row.year}</td>
                    <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatSek(row.revenue_sek)}</td>
                    <td className="px-3 py-2 text-foreground-muted mx-tnum">{row.employees ?? '–'}</td>
                    <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatSek(row.balance_sheet_sek)}</td>
                    <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatSek(row.equity_sek)}</td>
                    <td className="px-3 py-2 text-foreground-muted mx-tnum">
                      {row.dividend_reported ? formatSek(row.dividend_sek ?? 0) : '–'}
                    </td>
                    <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatSek(row.personnel_cost_sek)}</td>
                    <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatSek(row.corporate_tax_sek)}</td>
                    <td className="px-3 py-2">
                      <SourceBadge source={row.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {flags.isStaffOrObserver ? (
        <Section
          id="agarbild"
          title="Ägarbild"
          description="Ägare och innehav från bolagsregister (koncernstruktur + verklig huvudman). Fysiska personer visas utan namn."
          action={
            canAssess ? <PillLink href={`/bedomning-excellens?startup=${startup.id}`}>Bedöm mot art. 22 / Vinnova</PillLink> : null
          }
        >
          {ownership.length === 0 ? (
            <Empty>
              Ingen ägarbild synkad än.
              {canSyncRegistry && startup.org_nr && registries.some((p) => p.slug === 'roaring')
                ? ' Kör ”Synka från Roaring” under Finansiell historik.'
                : ' Anslut Roaring under Integrationer för att hämta den.'}
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-default">
              <table className="w-full text-sm">
                <thead className="bg-canvas-subtle text-left text-xs uppercase tracking-wider text-foreground-subtle">
                  <tr>
                    {['Riktning', 'Ägare / innehav', 'Typ', 'Kapital', 'Röster', 'Källa'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ownership.map((o) => (
                    <tr key={o.id} className="border-t border-default">
                      <td className="px-3 py-2 text-foreground-muted">
                        {o.direction === 'owner' ? 'Ägare' : 'Innehav'}
                        {o.indirect ? <span className="ml-1 text-xs text-foreground-subtle">(indirekt)</span> : null}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {o.owner_kind === 'person' ? 'Fysisk person' : o.name || '–'}
                        {o.org_nr && o.owner_kind !== 'person' ? (
                          <span className="ml-2 text-xs text-foreground-subtle mx-tnum">{o.org_nr}</span>
                        ) : null}
                        {o.control_basis ? <p className="text-xs text-foreground-subtle">{controlBasisLabel(o.control_basis)}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">{ownerKindLabel(o.owner_kind)}</td>
                      <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatPctOrRange(o.capital_pct, o.pct_min, o.pct_max)}</td>
                      <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatPctOrRange(o.voting_pct)}</td>
                      <td className="px-3 py-2">
                        <SourceBadge source={(o.source as FinancialsSource) || 'other'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      <Section
        id="kapital"
        title="Kapital"
        description={capital.length > 0 ? `Mottaget kapital totalt ${formatSek(capitalTotal)}.` : undefined}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Mottaget kapital</h3>
            {capital.length === 0 ? (
              <Empty>Inget mottaget kapital registrerat.</Empty>
            ) : (
              <ul className="divide-y divide-default">
                {capital.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{c.source}</p>
                      <p className="text-xs text-foreground-subtle">
                        {capitalTypeLabels[c.type] ?? c.type} · {formatDate(c.received_at)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-foreground mx-tnum">{formatSek(c.amount_sek)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Partner-engagemang</h3>
            {engagements.length === 0 ? (
              <Empty>Inga partner-engagemang.</Empty>
            ) : (
              <ul className="divide-y divide-default">
                {engagements.map((e) => (
                  <li key={e.id} className="py-2.5">
                    <p className="text-sm font-medium text-foreground">{e.expand?.partner?.name || 'Okänd partner'}</p>
                    <p className="text-xs text-foreground-subtle">
                      {e.engagement_type}
                      {e.amount_sek ? ` · ${formatSek(e.amount_sek)}` : ''}
                      {e.started_at ? ` · sedan ${formatDate(e.started_at)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section
        id="de-minimis"
        title="De minimis"
        description="Stöd av mindre betydelse — rullande treårssumma mot takbeloppen. Registrera stöd direkt här."
        action={
          <PillLink href={`/de-minimis/${startup.id}`}>
            Öppna fullskärm <Icon name="external" size={14} />
          </PillLink>
        }
      >
        <DeMinimisSection startupId={id} startupName={startup.name} canManage={canManageStartupDeMinimis(user, id)} />
      </Section>

      <StartupSupportChecksSection
        pb={pb}
        tenantId={user.tenant}
        startupId={id}
        isStaff={flags.isStaffOrObserver}
        canApply={flags.isStaff || user.linkedStartups.includes(id)}
      />

      {flags.isStaffOrObserver ? (
        <>
          <StartupScreeningSection
            pb={pb}
            tenantId={user.tenant}
            viewerRoles={user.roles}
            startupId={id}
            canAssess={canAssess}
            canRequest={hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])}
            feedback={screeningFeedback}
          />
          <StartupProcurementsSection pb={pb} tenantId={user.tenant} startupId={id} />
        </>
      ) : null}
    </TabPage>
  );
}

async function loadConnectedRegistries(
  pb: Awaited<ReturnType<typeof loadStartupPage>>['pb'],
  tenant: string
): Promise<ConnectedRegistryProvider[]> {
  try {
    const registrySlugs = new Set(listCompanyRegistrySlugs());
    const res = await pb
      .collection('tenant_integrations')
      .getList<{ status: string; pricing?: unknown; expand?: { provider?: { slug: string; name: string } } }>(1, 50, {
        filter: pb.filter('tenant = {:tenant} && status = "connected"', { tenant }),
        expand: 'provider',
        fields: 'id,status,pricing,expand.provider.slug,expand.provider.name'
      });
    return res.items
      .map((r) => ({ provider: r.expand?.provider, pricing: r.pricing }))
      .filter((x): x is { provider: { slug: string; name: string }; pricing: unknown } => !!x.provider && registrySlugs.has(x.provider.slug))
      .map(({ provider: p, pricing }) => {
        const h = getHandler(p.slug);
        const registry = h?.kind === 'company_registry' ? h : undefined;
        return {
          slug: p.slug,
          name: p.name,
          parts: registry?.parts ?? [],
          partEndpoints: registry?.partEndpoints?.(),
          pricing: resolveRegistryPricing(p.slug, pricing)
        };
      });
  } catch {
    return [];
  }
}

function ownerKindLabel(kind: OwnershipRow['owner_kind']): string {
  switch (kind) {
    case 'company':
      return 'Bolag';
    case 'person':
      return 'Fysisk person';
    case 'public_body':
      return 'Offentlig / akademi';
    case 'investor':
      return 'Investerare';
    default:
      return 'Okänd';
  }
}

function controlBasisLabel(v: string): string {
  const map: Record<string, string> = {
    shares: 'Ägande (aktier/kapital)',
    votes: 'Rösträtt',
    board: 'Rätt att utse styrelse/ledning',
    agreement: 'Kontroll via avtal/stadgar',
    other: 'Annan kontrollgrund'
  };
  return map[v] || v;
}

function formatPctOrRange(exact?: number, min?: number, max?: number): string {
  if (typeof exact === 'number') return `${exact.toLocaleString('sv-SE')} %`;
  if (typeof min === 'number' && typeof max === 'number') return `${min}–${max} %`;
  return '–';
}
