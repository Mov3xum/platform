import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  composeRegistryPricing,
  EMPTY_REGISTRY_PRICING,
  parseRegistryPricingJson,
  type RegistryPricing
} from './pricing';

// Läsvägen för leverantörens prislista (CLAUDE.md § 11.8): tenantens
// `tenant_integrations.pricing` (ledningens angivna priser) ovanpå
// env-defaulten på web-appen, ovanpå leverantörens PUBLICERADE listpris i
// koden (`REGISTRY_PROVIDER_PRICING`, daterat med källa). Högre nivå vinner
// per fält. Fail-soft: ett läsfel ger de lägre nivåerna (eller "ej angivet")
// — aldrig en gissning.

/** Prislistan för en ansluten leverantör i tenanten. */
export async function loadRegistryPricing(
  tenantId: string,
  providerSlug: string,
  pb?: PocketBase
): Promise<RegistryPricing> {
  const tenantPricing = await readTenantPricing(tenantId, providerSlug, pb);
  return composeRegistryPricing(providerSlug, process.env, tenantPricing);
}

/** Tolkar det lagrade json-värdet från en redan läst rad + env-defaulten. */
export function resolveRegistryPricing(providerSlug: string, storedPricing: unknown): RegistryPricing {
  return composeRegistryPricing(providerSlug, process.env, parseRegistryPricingJson(storedPricing));
}

async function readTenantPricing(tenantId: string, providerSlug: string, pb?: PocketBase): Promise<RegistryPricing> {
  const filterFor = (client: PocketBase) =>
    client.filter('tenant = {:tenant} && provider.slug = {:slug}', { tenant: tenantId, slug: providerSlug });
  const read = async (client: PocketBase) => {
    const row = await client
      .collection('tenant_integrations')
      .getFirstListItem<{ pricing?: unknown }>(filterFor(client), { fields: 'id,pricing' });
    return parseRegistryPricingJson(row.pricing);
  };
  if (pb) {
    try {
      return await read(pb);
    } catch {
      /* fall through — RLS/404 → superuser-reserv */
    }
  }
  const admin = await getSuperuserPb();
  if (!admin.ok) return { ...EMPTY_REGISTRY_PRICING };
  try {
    return await read(admin.pb);
  } catch {
    return { ...EMPTY_REGISTRY_PRICING };
  }
}
