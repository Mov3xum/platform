import 'server-only';
import type PocketBase from 'pocketbase';
import {
  DEFAULT_VAXELKURS_SEK_PER_EUR,
  SAMLAT_TAK_EUR,
  dropShadowedIrlLevels,
  normalizeScreeningFacts,
  samladSumma,
  type ExcellenceScreeningInput,
  type ScreeningManualFacts,
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
import { loadLatestIrlReading } from '@/lib/irl/data.server';

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
  /** Grundare i teamet (visningsnamn + andel) — staff-UI, aldrig AI-kontext. */
  founders: ScreeningFounderRow[];
  deMinimis: { usedEur: number; capEur: number } | null;
  financials: ScreeningFinancialsYear[];
  ownership: ScreeningOwnershipEntry[];
  groupStructureSaved: boolean;
  beneficialOwnersSaved: boolean;
  /** Controllerns sparade manuella svar (`startups.screening_facts`, § 51.4). */
  facts: ScreeningManualFacts;
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
              // Bedömningen är ett uppslag — även delar som bara gäller uppslag (§ 51.11).
              parts: [...registry.parts, ...(registry.lookupOnlyParts ?? [])],
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

/** IRL som bolagskortet redan har är inaktuella kopior i svaren (§ 52.2) — de används och sparas aldrig. */
function withoutShadowedIrl(facts: ScreeningManualFacts, irl: ScreeningIrl | null): ScreeningManualFacts {
  if (!facts.irl) return facts;
  const cleaned = dropShadowedIrlLevels(facts.irl, irl);
  const next: ScreeningManualFacts = { ...facts };
  if (cleaned) next.irl = cleaned;
  else delete next.irl;
  return next;
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
        'id,tenant,name,org_nr,bolagsform,bolag_status,company_registered_at,kommun,industri,irl_level,meets_excellence_criteria,screening_facts'
    });
  } catch {
    return null;
  }
  if (s.tenant !== tenantId) return null;
  const orgNr = normalizeOrgNr(str(s.org_nr)) ?? '';

  const byStartup = pb.filter('startup = {:id}', { id: startupId });
  const [finRes, ownRes, teamRes, stodRes, irlRes] = await Promise.allSettled([
    pb.collection('startup_financials').getList(1, 50, {
      filter: byStartup,
      sort: '-year',
      fields: 'year,employees,revenue_sek,balance_sheet_sek,equity_sek,net_result_sek,dividend_sek,dividend_reported'
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
    // IRL ur bolagskortets KTH-bedömning — samma rad som radarn visar (§ 52.2).
    loadLatestIrlReading(pb, tenantId, startupId)
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
            // Utdelning räknas bara när årsredovisningen faktiskt svarade (PB
            // lagrar 0 för ett tomt tal — § 51 / migration 1700000189).
            dividend_sek: r.dividend_reported === true ? num(r.dividend_sek) : undefined,
            dividend_reported: r.dividend_reported === true ? true : undefined
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
  if (irlRes.status === 'fulfilled' && irlRes.value) {
    const r = irlRes.value;
    // PB lagrar 0 för "ej bedömd" — normaliserat till null i `latestIrlReading`.
    const notes: NonNullable<ScreeningIrl['notes']> = {};
    for (const ax of ['crl', 'brl', 'tmrl'] as const) if (r.axisNotes[ax]) notes[ax] = r.axisNotes[ax];
    irl = {
      level: irl.level,
      crl: r.profile.crl ?? null,
      brl: r.profile.brl ?? null,
      tmrl: r.profile.tmrl ?? null,
      srl: r.srl,
      trl: r.profile.trl ?? null,
      iprl: r.profile.iprl ?? null,
      frl: r.profile.frl ?? null,
      assessedAt: r.assessedAt
    };
    if (Object.keys(notes).length > 0) irl.notes = notes;
  } else if (irlRes.status === 'rejected') {
    console.error('[excellence] irl read failed', { status: (irlRes.reason as { status?: number } | null)?.status });
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
    founders,
    deMinimis,
    financials,
    ownership,
    groupStructureSaved,
    beneficialOwnersSaved,
    facts: withoutShadowedIrl(normalizeScreeningFacts(s.screening_facts), irl)
  };
}

/**
 * Anknutet bolag som själv är portföljbolag: dess registrerade de minimis-
 * stöd läggs på koncernfakta (källa plattformen) så intyget inte behöver
 * matas in manuellt. Läses med användarens token (RLS) — `undefined` när
 * bolaget inte finns i plattformen.
 */
export async function attachPlatformDeMinimis(
  pb: PocketBase,
  tenantId: string,
  facts: GroupCompanyFacts
): Promise<GroupCompanyFacts> {
  if (!facts.orgNr || facts.deMinimis) return facts;
  const id = await findStartupByOrgNr(pb, tenantId, facts.orgNr);
  if (!id) return facts;
  const platform = await loadPlatformStartupFacts(pb, tenantId, id);
  if (!platform?.deMinimis) return facts;
  return { ...facts, name: facts.name ?? platform.name, deMinimis: { usedEur: platform.deMinimis.usedEur, source: 'platform' } };
}

/** Koncernbolag ur det som redan är sparat för ett portföljbolag. */
export function groupFactsFromSaved(f: PlatformStartupFacts): GroupCompanyFacts {
  return {
    orgNr: f.orgNr,
    name: f.name,
    dataFetched: true,
    deMinimis: f.deMinimis ? { usedEur: f.deMinimis.usedEur, source: 'platform' } : undefined,
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
          sni: company.sni && company.sni.length > 0 ? company.sni : undefined
        }
      : undefined,
    // Ägarnas andra bolag (§ 51.11) — bara när delen hämtades.
    ownerEngagements: fetched.includes('owner_engagements')
      ? (company.ownerEngagements ?? []).map((e) => ({
          person_name: e.person_name,
          subject_capital_pct: e.subject_capital_pct,
          subject_pct_min: e.subject_pct_min,
          subject_pct_max: e.subject_pct_max,
          status: e.status,
          reason: e.reason,
          companies: e.companies.map((c) => ({
            org_nr: c.org_nr ? (normalizeOrgNr(c.org_nr) ?? undefined) : undefined,
            name: c.name,
            capital_pct: c.capital_pct,
            pct_min: c.pct_min,
            pct_max: c.pct_max,
            control_basis: c.control_basis,
            note: c.note,
            basic: c.basic
              ? {
                  registeredAt: c.basic.registered_at,
                  bolagStatus: c.basic.bolag_status,
                  bolagsform: c.basic.bolagsform,
                  sni: c.basic.sni && c.basic.sni.length > 0 ? c.basic.sni : undefined
                }
              : undefined
          }))
        }))
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
      person_name: o.owner_kind === 'person' ? o.person_name : undefined,
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
    beneficialOwnersFetched: fetched.includes('beneficial_owners') || noRecord.includes('beneficial_owners'),
    // Hela koncernen ur den platta listan (moder, syskon, dotter) — bara när
    // koncernstrukturen faktiskt hämtades; "inga uppgifter" = tom koncern.
    groupMembers: fetched.includes('group_structure')
      ? (company.group ?? []).map((m) => ({
          org_nr: m.org_nr ? (normalizeOrgNr(m.org_nr) ?? undefined) : undefined,
          name: m.name,
          level: m.level,
          mother_org_nr: m.mother_org_nr ? (normalizeOrgNr(m.mother_org_nr) ?? undefined) : undefined,
          mother_name: m.mother_name,
          owned_pct: m.owned_pct
        }))
      : noRecord.includes('group_structure')
        ? []
        : undefined
  };
}

/**
 * Plattformens egna fakta (finns inte hos leverantören) — delas av båda
 * lägena. Manuella svar (`manual`) kan ge grundarteamet när det inte finns i
 * teamet på bolagskortet (eller ska kompletteras med engagemang): då är
 * källan "manuell", annars teamet.
 */
export function platformPart(
  platform: Pick<PlatformStartupFacts, 'founders' | 'deMinimis' | 'irl' | 'meetsExcellence'> | null,
  manual: ScreeningManualFacts | undefined
): Pick<ExcellenceScreeningInput, 'founders' | 'foundersSource' | 'deMinimis' | 'irl' | 'meetsExcellenceFlag' | 'sekPerEur' | 'manual'> {
  const manualFounders = manual?.founders && manual.founders.length > 0 ? manual.founders : undefined;
  return {
    founders: manualFounders ?? (platform ? platform.founders : undefined),
    foundersSource: manualFounders ? 'manual' : 'platform',
    deMinimis: platform ? platform.deMinimis : null,
    irl: platform?.irl ?? null,
    meetsExcellenceFlag: platform ? platform.meetsExcellence : undefined,
    sekPerEur: DEFAULT_VAXELKURS_SEK_PER_EUR,
    manual
  };
}
