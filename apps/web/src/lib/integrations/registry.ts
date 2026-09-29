import 'server-only';
import type { IntegrationHandler } from './types';
import { brevoHandler } from './providers/brevo/handler';
import { howspaceHandler } from './providers/howspace/handler';
import { allabolagHandler } from './providers/allabolag/handler';
import { roaringHandler } from './providers/roaring/handler';
import { bolagsverketHandler } from './providers/bolagsverket/handler';

// Add new providers here. Slug must match integration_providers.slug
// in the seed migration.
const HANDLERS: Record<string, IntegrationHandler> = {
  brevo: brevoHandler,
  howspace: howspaceHandler,
  allabolag: allabolagHandler,
  roaring: roaringHandler,
  bolagsverket: bolagsverketHandler
};

// Bolagsregister-providers (kind 'company_registry', § 11.8) — används av
// bolagskortets synk-knappar och av per-startup-actionen för att veta vilka
// slugs som får synka ett enskilt bolag.
export function listCompanyRegistrySlugs(): string[] {
  return Object.values(HANDLERS)
    .filter((h) => h.kind === 'company_registry')
    .map((h) => h.slug);
}

export function getHandler(slug: string): IntegrationHandler | null {
  return HANDLERS[slug] ?? null;
}

export function hasHandler(slug: string): boolean {
  return slug in HANDLERS;
}

export function listHandlerSlugs(): string[] {
  return Object.keys(HANDLERS);
}
