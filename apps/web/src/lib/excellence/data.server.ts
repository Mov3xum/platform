import 'server-only';
import type PocketBase from 'pocketbase';
import {
  DEFAULT_VAXELKURS_SEK_PER_EUR,
  SAMLAT_TAK_EUR,
  normalizeExcellenceManualReview,
  samladSumma,
  type ExcellenceManualReview,
  type ExcellenceScreeningInput,
  type ScreeningPlatformHints,
  type GroupCompanyFacts,
  type ScreeningFinancialsYear,
  type ScreeningFounderRow,
  type ScreeningIrl,
  type ScreeningOwnerKind,
  type ScreeningOwnershipEntry
} from '@platform/shared';
import { escFilter } from '@/lib/pb-filter';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { getHandler, listCompanyRegistrySlugs } from '@/lib/integrations/registry';
import { isPersonalOrgNr, normalizeOrgNr } from '@/lib/integrations/company-registry/orgnr';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';
import { resolveRegistryPricing } from '@/lib/integrations/company-registry/pricing.server';
import type { RegistryPricing } from '@/lib/integrations/company-registry/pricing';
import type { RegistryCompany } from '@/lib/integrations/company-registry/types';

// Läsvägar för "Bedömning excellens" (CLAUDE.md § 51). Allt läses med
// användarens token (RLS § 21) — sidan är en ny lins på data personalen redan
// får se, ingen ny dataväg. Fail-soft: ett läsfel ger `null`/tomt, och
// bedömningen visar då OKÄNT med vad som saknas i stället för att gissa.

export interface ScreenableStartup {
  id: string;
  name: string;
  org_nr: string;
}

export interface ConnectedRegistry {
  slug: string;
  name: string;
  parts: RegistryPartId[];
  partEndpoints?: Partial<Record<RegistryPartId, string>>;
  /** Prislista (§ 11.8) — kostnaden visas innan uppslagen görs. */
  pricing: RegistryPricing;
}

export interface PlatformStartupFacts {
  id: string;
  name: string;
  orgNr: string;
  bolagsform?: string;
  bolagStatus?: string;
  registeredAt?: string;
  kommun?: string;
  industri?: string;
  irl: ScreeningIrl | null;
  meetsExcellence: boolean;
  /** Controllerns manuella komplettering (`startups.excellence_review`, § 51.5). */
  manual: ExcellenceManualReview;
  /** Sant när fältet `excellence_review` finns i schemat (annars kan inget sparas). */
  manualFieldPresent: boolean;
  /** Plattformsflaggor/statsstödsgrund som förifyller de manuella punkterna. */
  hints: ScreeningPlatformHints;
  /** Grundare i teamet (visningsnamn + andel) — staff-UI, aldrig AI-kontext. */
  founders: ScreeningFounderRow[];
  deMinimis: { usedEur: number; capEur: number } | null;
  financials: ScreeningFinancialsYear[];
  ownership: ScreeningOwnershipEntry[];
  groupStructureSaved: boolean;
  beneficialOwnersSaved: boolean;
}

const OWNER_KINDS: ReadonlySet<string> = new Set(['company', 'person', 'public_body', 'investor', 'other']);

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export async function listScreenableStartups(pb: PocketBase, tenantId: string): Promise<ScreenableStartup[]> {
  try {
    const res = await pb.collection('startups').getList<ScreenableStartup>(1, 500, {
      filter: pb.filter('tenant = {:tenant} && org_nr != ""', { tenant: tenantId }),
      sort: 'name',
      fields: 'id,name,org_nr'
    });
    return res.items;
  } catch {
    return [];
  }
}

/** Portföljbolag med ett visst org-nr (anknutna bolag kan själva vara portföljbolag). */
export async function findStartupByOrgNr(pb: PocketBase, tenantId: string, orgNr: string): Promise<string | null> {
  const candidates = [orgNr, `${orgNr.slice(0, 6)}-${orgNr.slice(6)}`];
  try {
    const res = await pb.collection('startups').getList<{ id: string }>(1, 1, {
      filter: pb.filter('tenant = {:tenant} && (org_nr = {:a} || org_nr = {:b})', {
        tenant: tenantId,
        a: candidates[0],
        b: candidates[1]
      }),
      fields: 'id'
    });
    return res.items[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Tenantens anslutna bolagsregister-providers (bara de med uppslag). */
export async function listConnectedRegistries(pb: PocketBase, tenantId: string): Promise<ConnectedRegistry[]> {
  try {
    const registrySlugs = new Set(listCompanyRegistrySlugs());
    const res = await pb
      .collection('tenant_integrations')
      .getList<{ pricing?: unknown; expand?: { provider?: { slug: string; name: string } } }>(1, 50, {
        filter: pb.filter('tenant = {:tenant} && status = "connected"', { tenant: tenantId }),
        expand: 'provider',
        fields: 'id,pricing,expand.provider.slug,expand.provider.name'
      });
    return res.items
      .map((r) => ({ provider: r.expand?.provider, pricing: r.pricing }))
      .filter((x): x is { provider: { slug: string; name: string }; pricing: unknown } => !!x.provider && registrySlugs.has(x.provider.slug))
      .map(({ provider: p, pricing }): ConnectedRegistry | null => {
        const h = getHandler(p.slug);
        const registry = h?.kind === 'company_registry' && h.lookup ? h : undefined;
        return registry
          ? {
              slug: p.slug,
              name: p.name,
              parts: registry.parts,
              partEndpoints: registry.partEndpoints?.(),
              pricing: resolveRegistryPricing(p.slug, pricing)
            }
          : null;
      })
      .filter((p): p is ConnectedRegistry => p !== null)
      // Roaring först — den enda med ägarbild.
      .sort((a, b) => (a.slug === 'roaring' ? -1 : b.slug === 'roaring' ? 1 : a.name.localeCompare(b.name, 'sv')));
  } catch {
    return [];
  }
}

function mapOwnershipRow(r: Record<string, unknown>): ScreeningOwnershipEntry {
  const kind = String(r.owner_kind || 'other');
  const entry: ScreeningOwnershipEntry = {
    direction: r.direction === 'holding' ? 'holding' : 'owner',
    owner_kind: (OWNER_KINDS.has(kind) ? kind : 'other') as ScreeningOwnerKind
  };
  // Namn/org-nr bara för juridiska personer (defense-in-depth ovanpå writer.ts).
  if (entry.owner_kind !== 'person') {
    entry.name = str(r.name);
    entry.org_nr = normalizeOrgNr(str(r.org_nr)) ?? undefined;
  }
  entry.capital_pct = num(r.capital_pct);
  entry.voting_pct = num(r.voting_pct);
  entry.pct_min = num(r.pct_min);
  entry.pct_max = num(r.pct_max);
  const basis = str(r.control_basis);
  if (basis && /^[a-z_]{1,20}$/.test(basis)) entry.control_basis = basis;
  if (r.indirect === true) entry.indirect = true;
  const part = str(r.source_part);
  if (part === 'group_structure' || part === 'beneficial_owners') entry.part = part;
  return entry;
}

/**
 * Bolagets fakta ur plattformen. `null` när bolaget inte finns i tenanten
 * (eller inte får läsas av användaren).
 */
export async function loadPlatformStartupFacts(
  pb: PocketBase,
  tenantId: string,
  startupId: string
): Promise<PlatformStartupFacts | null> {
  let s: Record<string, unknown>;
  try {
    s = await pb.collection('startups').getOne(startupId, {
      fields:
        'id,tenant,name,org_nr,bolagsform,bolag_status,company_registered_at,kommun,industri,irl_level,meets_excellence_criteria,is_deeptech,approved_de_minimis,approved_state_aid_art22,excellence_review'
    });
  } catch {
    return null;
  }
  if (s.tenant !== tenantId) return null;
  const orgNr = normalizeOrgNr(str(s.org_nr)) ?? '';

  const byStartup = pb.filter('startup = {:id}', { id: startupId });
  const todayKey = new Date().toISOString().slice(0, 10);
  const [finRes, ownRes, teamRes, stodRes, irlRes, aidRes] = await Promise.allSettled([
    pb.collection('startup_financials').getList(1, 50, {
      filter: byStartup,
      sort: '-year',
      fields: 'year,employees,revenue_sek,balance_sheet_sek,equity_sek,net_result_sek,dividend_sek'
    }),
    pb.collection('startup_ownership').getList(1, 100, {
      filter: pb.filter('startup = {:id} && tenant = {:tenant}', { id: startupId, tenant: tenantId })
    }),
    pb.collection('startup_team_members').getList(1, 50, {
      filter: pb.filter('startup = {:id} && is_founder = true', { id: startupId }),
      fields: 'id,name,equity_pct'
    }),
    pb.collection(PB_COLLECTIONS.deMinimisStod).getFullList({
      filter: `startup = "${escFilter(startupId)}"`,
      fields: 'forordning,belopp_eur,beslutsdatum'
    }),
    pb.collection('startup_readiness_assessments').getList(1, 1, {
      filter: byStartup,
      sort: '-assessed_at',
      fields: 'assessed_at,crl,brl,tmrl,srl'
    }),
    // Gällande statsstödsgrund (pågående period) — jämförelse i resultatet.
    pb.collection('startup_state_aid_periods').getList(1, 1, {
      filter: pb.filter('startup = {:s} && (valid_to = "" || valid_to >= {:d})', { s: startupId, d: todayKey }),
      sort: '-valid_from',
      fields: 'basis,valid_from'
    })
  ]);

  const financials: ScreeningFinancialsYear[] =
    finRes.status === 'fulfilled'
      ? (finRes.value.items as Record<string, unknown>[])
          .filter((r) => typeof r.year === 'number')
          .map((r) => ({
            year: r.year as number,
            employees: num(r.employees),
            revenue_sek: num(r.revenue_sek),
            balance_sheet_sek: num(r.balance_sheet_sek),
            equity_sek: num(r.equity_sek),
            net_result_sek: num(r.net_result_sek),
            dividend_sek: num(r.dividend_sek)
          }))
      : [];

  const ownRows = ownRes.status === 'fulfilled' ? (ownRes.value.items as Record<string, unknown>[]) : [];
  const ownership = ownRows.map(mapOwnershipRow);
  // Rader utan `source_part` (sparade före 1700000182) räknas till båda delarna.
  const groupStructureSaved = ownRows.some((r) => !r.source_part || r.source_part === 'group_structure');
  const beneficialOwnersSaved = ownRows.some((r) => !r.source_part || r.source_part === 'beneficial_owners');

  const founders: ScreeningFounderRow[] =
    teamRes.status === 'fulfilled'
      ? (teamRes.value.items as Record<string, unknown>[]).map((m) => ({
          name: str(m.name) ?? 'Grundare',
          equity_pct: num(m.equity_pct)
        }))
      : [];

  let deMinimis: PlatformStartupFacts['deMinimis'] = null;
  if (stodRes.status === 'fulfilled') {
    const rows = (stodRes.value as unknown as Record<string, unknown>[])
      .filter((r) => typeof r.belopp_eur === 'number' && typeof r.beslutsdatum === 'string')
      .map((r) => ({
        forordning: r.forordning as never,
        belopp_eur: r.belopp_eur as number,
        beslutsdatum: r.beslutsdatum as string
      }));
    deMinimis = { usedEur: samladSumma(rows, new Date()), capEur: SAMLAT_TAK_EUR };
  }

  let irl: ScreeningIrl | null = { level: num(s.irl_level) ?? null };
  if (irlRes.status === 'fulfilled' && irlRes.value.items[0]) {
    const r = irlRes.value.items[0] as Record<string, unknown>;
    irl = {
      level: irl.level,
      crl: num(r.crl) ?? null,
      brl: num(r.brl) ?? null,
      tmrl: num(r.tmrl) ?? null,
      srl: num(r.srl) ?? null,
      assessedAt: str(r.assessed_at)?.slice(0, 10)
    };
  }

  const hints: ScreeningPlatformHints = {
    isDeeptech: s.is_deeptech === true || undefined,
    approvedDeMinimis: s.approved_de_minimis === true || undefined,
    approvedArt22: s.approved_state_aid_art22 === true || undefined
  };
  if (aidRes.status === 'fulfilled' && aidRes.value.items[0]) {
    const r = aidRes.value.items[0] as Record<string, unknown>;
    if (r.basis === 'art22' || r.basis === 'de_minimis') {
      hints.stateAidBasis = { basis: r.basis, validFrom: str(r.valid_from)?.slice(0, 10) };
    }
  }

  return {
    id: String(s.id),
    name: str(s.name) ?? 'Namnlöst bolag',
    orgNr,
    bolagsform: str(s.bolagsform),
    bolagStatus: str(s.bolag_status),
    registeredAt: str(s.company_registered_at)?.slice(0, 10),
    kommun: str(s.kommun),
    industri: str(s.industri),
    irl,
    meetsExcellence: s.meets_excellence_criteria === true,
    manual: normalizeExcellenceManualReview(s.excellence_review),
    manualFieldPresent: 'excellence_review' in s,
    hints,
    founders,
    deMinimis,
    financials,
    ownership,
    groupStructureSaved,
    beneficialOwnersSaved
  };
}

/** Koncernbolag ur det som redan är sparat för ett portföljbolag. */
export function groupFactsFromSaved(f: PlatformStartupFacts): GroupCompanyFacts {
  return {
    orgNr: f.orgNr,
    name: f.name,
    dataFetched: true,
    basic: {
      registeredAt: f.registeredAt,
      bolagStatus: f.bolagStatus,
      bolagsform: f.bolagsform,
      isPersonal: f.orgNr ? isPersonalOrgNr(f.orgNr) : false
    },
    financials: f.financials.length > 0 ? f.financials : undefined,
    ownership: f.ownership,
    groupStructureFetched: f.groupStructureSaved,
    beneficialOwnersFetched: f.beneficialOwnersSaved
  };
}

/** Koncernbolag ur ett färskt registeruppslag. */
export function groupFactsFromRegistry(company: RegistryCompany, fallbackName?: string): GroupCompanyFacts {
  const fetched = company.fetchedParts ?? [];
  const noRecord = company.noRecordParts ?? [];
  return {
    orgNr: company.org_nr,
    name: company.name ?? fallbackName,
    dataFetched: true,
    basic: fetched.includes('basic')
      ? {
          registeredAt: company.startup.company_registered_at,
          bolagStatus: company.startup.bolag_status,
          bolagsform: company.startup.bolagsform,
          isPersonal: company.isPersonal,
          listed: company.listed
        }
      : undefined,
    // "Inga uppgifter" (404 hos leverantören — nystartat bolag utan bokslut)
    // är ett SVAR, inte ett uteblivet uppslag: tom lista i stället för
    // undefined så tröskelraden säger "inget bokslut i registret".
    financials: fetched.includes('financials') ? company.financials : noRecord.includes('financials') ? [] : undefined,
    ownership: company.ownership.map((o) => ({
      direction: o.direction,
      owner_kind: o.owner_kind,
      name: o.owner_kind === 'person' ? undefined : o.name,
      org_nr: o.owner_kind === 'person' ? undefined : (normalizeOrgNr(o.org_nr) ?? undefined),
      capital_pct: o.capital_pct,
      voting_pct: o.voting_pct,
      pct_min: o.pct_min,
      pct_max: o.pct_max,
      control_basis: o.control_basis,
      indirect: o.indirect,
      part: o.part === 'group_structure' || o.part === 'beneficial_owners' ? o.part : undefined
    })),
    // Ett bolag utanför varje koncern / utan registrerade huvudmän får 404 —
    // delen ÄR hämtad (svaret är "inga rader"), annars ser varje fristående
    // bolag ut som ett ohämtat.
    groupStructureFetched: fetched.includes('group_structure') || noRecord.includes('group_structure'),
    beneficialOwnersFetched: fetched.includes('beneficial_owners') || noRecord.includes('beneficial_owners')
  };
}

/** Plattformens egna fakta (finns inte hos leverantören) — delas av båda lägena. */
export function platformPart(platform: PlatformStartupFacts | null): Pick<
  ExcellenceScreeningInput,
  'founders' | 'deMinimis' | 'irl' | 'meetsExcellenceFlag' | 'sekPerEur' | 'manual' | 'platformHints'
> {
  return {
    founders: platform ? platform.founders : undefined,
    deMinimis: platform ? platform.deMinimis : null,
    irl: platform?.irl ?? null,
    meetsExcellenceFlag: platform ? platform.meetsExcellence : undefined,
    sekPerEur: DEFAULT_VAXELKURS_SEK_PER_EUR,
    manual: platform?.manual,
    platformHints: platform?.hints
  };
}
