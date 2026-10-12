import 'server-only';
import type PocketBase from 'pocketbase';
import { getServerPb, type SessionUser } from '@/lib/auth.server';
import { escFilter } from '@/lib/pb-filter';
import { getSuperuserPb, loadCredentialsResult } from '@/lib/integrations/credentials';
import { describeCredentialFailure } from '@/lib/integrations/credential-errors';
import { getHandler, listCompanyRegistrySlugs } from '@/lib/integrations/registry';
import { recordActivity } from '@/lib/actions/record-activity';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { describeRegistryParts, parseRegistryParts, type RegistryPartId } from './parts';
import { isPersonalOrgNr, isValidOrgNr, normalizeOrgNr } from './orgnr';
import type { RegistryCompany, RegistrySource as RegistryWriteSource } from './types';
import { applyRegistryCompany, type RegistryWriteResult } from './writer';
import { estimateRegistryCost, formatRegistryCost, type RegistryCostEstimate, type RegistryPricing } from './pricing';
import { resolveRegistryPricing } from './pricing.server';

// Uppslag på ett valfritt bolag hos en ansluten bolagsregister-leverantör
// (CLAUDE.md § 11.8 "Testa mot org-nr" och § 51 "Bedömning excellens"). En
// kärna för båda ytorna — validering, rate-limit (leverantörerna debiterar
// per anrop), credentials och PII-fri audit får aldrig divergera. Som default
// sparas inget; med `persistToStartupId` skrivs det hämtade till bolagskortet
// via EXAKT samma skrivväg som "Synka från <leverantör>" (`applyRegistryCompany`,
// § 11.8) — ett betalt uppslag ska inte behöva göras om för att se datan. Inte en 'use server'-modul: funktionen tar en redan
// verifierad användare och får inte bli en egen server action.

export type RegistryLookupResult =
  | {
      ok: true;
      company: RegistryCompany;
      requestedParts: RegistryPartId[];
      orgNr: string;
      /** Tenantens prislista för leverantören (§ 11.8). */
      pricing: RegistryPricing;
      /** Uppskattad kostnad för DETTA uppslag: valda delar × 1 bolag. */
      cost: RegistryCostEstimate;
      /** Satt när `persistToStartupId` gavs: vad som skrevs till bolagskortet. */
      saved?: RegistrySaveSummary;
    }
  | { ok: false; error: string };

export interface RegistrySaveSummary {
  startupId: string;
  /** Delar som hämtades OCH skrevs (PII-fritt, för audit/UI). */
  parts: RegistryPartId[];
  startupUpdated: boolean;
  financialsUpserted: number;
  ownershipWritten: number;
  /** PII-fria skrivfel per del — tomt = allt skrevs. */
  errors: string[];
}

export interface RegistryLookupOptions {
  providerSlug: string;
  orgNrRaw: string;
  /** Formuläret med kryssrutorna (`parts_present` + `parts`). */
  formData?: FormData;
  /** Explicit val av delar (vinner över formuläret) — prövas mot providerns delar. */
  parts?: RegistryPartId[];
  /** Titel på audit-raden (utan leverantör). */
  auditLabel: string;
  /**
   * Portföljbolag (id) vars kort ska få det hämtade — samma skrivväg som
   * "Synka från <leverantör>". Bolaget tenant-verifieras mot användaren innan
   * något skrivs; org-nr på kortet måste matcha uppslaget.
   */
  persistToStartupId?: string;
}

function readRequestedParts(
  formData: FormData | undefined,
  supported: RegistryPartId[]
): { ok: true; parts: RegistryPartId[] | undefined } | { ok: false; error: string } {
  if (!formData || !formData.has('parts_present')) return { ok: true, parts: undefined };
  const parsed = parseRegistryParts(formData.getAll('parts'), supported);
  if (!parsed.ok) return parsed;
  return { ok: true, parts: parsed.parts };
}

/**
 * Anroparen MÅSTE ha verifierat rollen (admin/incubator_lead) — funktionen
 * prövar inte behörighet själv, bara indata, tenantens koppling och taket.
 */
export async function runRegistryLookup(
  user: SessionUser,
  opts: RegistryLookupOptions
): Promise<RegistryLookupResult> {
  const providerSlug = opts.providerSlug.trim();
  // Godtar 559572-8790, 5595728790, 16559572…, mellanslag och momsnummer.
  const orgNr = normalizeOrgNr(opts.orgNrRaw.trim());
  if (!listCompanyRegistrySlugs().includes(providerSlug)) {
    return { ok: false, error: 'Okänd bolagsregister-leverantör.' };
  }
  if (!orgNr) {
    return {
      ok: false,
      error:
        'Ange ett svenskt organisationsnummer med 10 siffror (t.ex. 559572-8790). Roarings interna test-id:n (t.ex. B00000018) är inte org-nummer.'
    };
  }
  if (!isValidOrgNr(orgNr)) {
    return { ok: false, error: 'Organisationsnumret har fel kontrollsiffra — kontrollera numret.' };
  }
  // Enskild firma: org-nr = personnummer → uppslag på en fysisk person görs
  // aldrig härifrån (GDPR § 5).
  if (isPersonalOrgNr(orgNr)) {
    return { ok: false, error: 'Uppslag stöds bara för juridiska personer (inte enskild firma).' };
  }
  // Rate-limit per användare (20 uppslag / 10 min) — delad mellan ytorna.
  const rateKey = `registry-lookup:${user.id}`;
  const limited = await checkRateLimit(rateKey, 20);
  if (limited.blocked) {
    return { ok: false, error: `För många uppslag — försök igen om ${limited.retryAfterSec} s.` };
  }
  await recordFailure(rateKey, 10 * 60 * 1000);
  const handler = getHandler(providerSlug);
  if (!handler || handler.kind !== 'company_registry' || !handler.lookup) {
    return { ok: false, error: 'Leverantören stödjer inte uppslag.' };
  }
  const requested = opts.parts
    ? parseRegistryParts(opts.parts, handler.parts)
    : readRequestedParts(opts.formData, handler.parts);
  if (!requested.ok) return { ok: false, error: requested.error };

  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) return { ok: false, error: 'Serverkonfiguration ofullständig.' };
  let providerId: string;
  try {
    const provider = await adminResult.pb
      .collection('integration_providers')
      .getFirstListItem<{ id: string }>(`slug = "${escFilter(providerSlug)}"`, { fields: 'id' });
    providerId = provider.id;
  } catch {
    return { ok: false, error: 'Leverantören saknas i katalogen.' };
  }
  let tenantIntegration: { id: string; status: string; pricing?: unknown };
  try {
    tenantIntegration = await adminResult.pb
      .collection('tenant_integrations')
      .getFirstListItem<{ id: string; status: string; pricing?: unknown }>(
        `tenant = "${escFilter(user.tenant)}" && provider = "${escFilter(providerId)}"`,
        { fields: 'id,status,pricing' }
      );
  } catch {
    return { ok: false, error: 'Anslut leverantören först (Inställningar → Integrationer).' };
  }
  if (tenantIntegration.status !== 'connected') {
    return { ok: false, error: 'Leverantören är inte ansluten för denna tenant.' };
  }
  const loaded = await loadCredentialsResult(tenantIntegration.id);
  if (!loaded.ok) return { ok: false, error: describeCredentialFailure(loaded.reason) };

  // Kostnaden räknas på det som BEGÄRS (varje valt API anropas och
  // debiteras oavsett om svaret blir tomt) — tenantens prislista + env.
  const requestedParts = requested.parts ?? handler.parts;
  const pricing = resolveRegistryPricing(providerSlug, tenantIntegration.pricing);
  const cost = estimateRegistryCost(pricing, requestedParts, 1);

  let company: RegistryCompany;
  try {
    company = await handler.lookup(orgNr, loaded.value, requested.parts);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Uppslaget misslyckades.' };
  }
  // Valfritt: skriv det hämtade till bolagskortet (§ 11.8 writer — samma
  // whitelist, idempotens och per-del-ersättning av ägarbilden som synken).
  let saved: RegistrySaveSummary | undefined;
  if (opts.persistToStartupId) {
    saved = await persistLookup(adminResult.pb, user.tenant, opts.persistToStartupId, orgNr, company, handler);
  }
  // Audit (ISO 27001 A.8.15): PII-fri rad — leverantör, antal och uppskattad
  // kostnad (credits/kr enligt angivna priser), aldrig org-nr.
  try {
    const pb = await getServerPb();
    const savedLabel = saved
      ? saved.errors.length > 0
        ? `sparat på bolagskortet med fel: ${saved.errors.join('; ').slice(0, 160)}`
        : `sparat på bolagskortet: ${describeRegistryParts(saved.parts)}`
      : 'inget sparat';
    await recordActivity(pb, {
      tenant: user.tenant,
      kind: 'integration_sync',
      actor: user.id,
      startup: saved?.startupId,
      title: `${providerSlug}: ${opts.auditLabel}`,
      meta: `${company.financials.length} årsrader, ${company.ownership.length} ägarrader (${savedLabel})${
        company.fetchedParts ? ` · Valda delar: ${describeRegistryParts(company.fetchedParts)}` : ''
      } · Kostnad: ${formatRegistryCost(cost)}`
    });
  } catch {
    /* audit får aldrig blockera */
  }
  return { ok: true, company, requestedParts, orgNr, pricing, cost, saved };
}

/**
 * Skriver ett redan hämtat bolag till ett portföljbolags kort. Superuser-
 * klienten används som i synken, därför verifieras bolagets tenant OCH att
 * kortets org-nr är det som slogs upp — aldrig skrivning av ett annat bolags
 * data på kortet. Fail-soft: skrivfel rapporteras, uppslaget är redan gjort.
 */
async function persistLookup(
  pb: PocketBase,
  tenantId: string,
  startupId: string,
  orgNr: string,
  company: RegistryCompany,
  handler: { source: RegistryWriteSource; parts: RegistryPartId[] }
): Promise<RegistrySaveSummary> {
  const base: RegistrySaveSummary = {
    startupId,
    parts: [],
    startupUpdated: false,
    financialsUpserted: 0,
    ownershipWritten: 0,
    errors: []
  };
  let row: { id: string; tenant: string; org_nr?: string };
  try {
    row = await pb.collection('startups').getOne<{ id: string; tenant: string; org_nr?: string }>(startupId, {
      fields: 'id,tenant,org_nr'
    });
  } catch {
    return { ...base, errors: ['Bolaget hittades inte — inget skrevs till bolagskortet.'] };
  }
  if (row.tenant !== tenantId) return { ...base, errors: ['Bolaget tillhör en annan tenant — inget skrevs.'] };
  if (normalizeOrgNr(row.org_nr) !== orgNr) {
    return { ...base, errors: ['Bolagskortets org-nr matchar inte uppslaget — inget skrevs.'] };
  }
  const parts = company.fetchedParts ?? [];
  if (parts.length === 0) return { ...base, errors: ['Ingen vald del gav data — inget skrevs till bolagskortet.'] };
  let r: RegistryWriteResult;
  try {
    r = await applyRegistryCompany(pb, tenantId, startupId, company, handler.source, new Date().toISOString(), handler.parts);
  } catch (err) {
    return { ...base, parts, errors: [err instanceof Error ? err.message.slice(0, 200) : 'Skrivningen misslyckades.'] };
  }
  return {
    startupId,
    parts,
    startupUpdated: r.startupUpdated,
    financialsUpserted: r.financialsUpserted,
    ownershipWritten: r.ownershipWritten,
    errors: r.errors
  };
}
