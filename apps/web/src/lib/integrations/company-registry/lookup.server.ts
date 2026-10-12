import 'server-only';
import { getServerPb, type SessionUser } from '@/lib/auth.server';
import { escFilter } from '@/lib/pb-filter';
import { getSuperuserPb, loadCredentialsResult } from '@/lib/integrations/credentials';
import { describeCredentialFailure } from '@/lib/integrations/credential-errors';
import { getHandler, listCompanyRegistrySlugs } from '@/lib/integrations/registry';
import { recordActivity } from '@/lib/actions/record-activity';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { describeRegistryParts, parseRegistryParts, type RegistryPartId } from './parts';
import { isPersonalOrgNr, isValidOrgNr, normalizeOrgNr } from './orgnr';
import type { RegistryCompany } from './types';
import { estimateRegistryCost, formatRegistryCost, type RegistryCostEstimate, type RegistryPricing } from './pricing';
import { resolveRegistryPricing } from './pricing.server';

// Uppslag på ett valfritt bolag hos en ansluten bolagsregister-leverantör
// UTAN att något sparas (CLAUDE.md § 11.8 "Testa mot org-nr" och § 51
// "Bedömning excellens"). En kärna för båda ytorna — validering, rate-limit
// (leverantörerna debiterar per anrop), credentials och PII-fri audit får
// aldrig divergera. Inte en 'use server'-modul: funktionen tar en redan
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
    }
  | { ok: false; error: string };

export interface RegistryLookupOptions {
  providerSlug: string;
  orgNrRaw: string;
  /** Formuläret med kryssrutorna (`parts_present` + `parts`). */
  formData?: FormData;
  /** Explicit val av delar (vinner över formuläret) — prövas mot providerns delar. */
  parts?: RegistryPartId[];
  /** Titel på audit-raden (utan leverantör). */
  auditLabel: string;
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
  // Audit (ISO 27001 A.8.15): PII-fri rad — leverantör, antal och uppskattad
  // kostnad (credits/kr enligt angivna priser), aldrig org-nr.
  try {
    const pb = await getServerPb();
    await recordActivity(pb, {
      tenant: user.tenant,
      kind: 'integration_sync',
      actor: user.id,
      title: `${providerSlug}: ${opts.auditLabel}`,
      meta: `${company.financials.length} årsrader, ${company.ownership.length} ägarrader (inget sparat)${
        company.fetchedParts ? ` · Valda delar: ${describeRegistryParts(company.fetchedParts)}` : ''
      } · Kostnad: ${formatRegistryCost(cost)}`
    });
  } catch {
    /* audit får aldrig blockera */
  }
  return { ok: true, company, requestedParts, orgNr, pricing, cost };
}
