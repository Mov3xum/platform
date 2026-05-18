import 'server-only';
import type { IntegrationHandler } from './types';
import { brevoHandler } from './providers/brevo/handler';
import { howspaceHandler } from './providers/howspace/handler';
import { allabolagHandler } from './providers/allabolag/handler';

// Add new providers here. Slug must match integration_providers.slug
// in the seed migration.
const HANDLERS: Record<string, IntegrationHandler> = {
  brevo: brevoHandler,
  howspace: howspaceHandler,
  allabolag: allabolagHandler
};

export function getHandler(slug: string): IntegrationHandler | null {
  return HANDLERS[slug] ?? null;
}

export function hasHandler(slug: string): boolean {
  return slug in HANDLERS;
}

export function listHandlerSlugs(): string[] {
  return Object.keys(HANDLERS);
}
