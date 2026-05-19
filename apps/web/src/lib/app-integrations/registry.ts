import 'server-only';
import type { OAuthProvider } from './types';
import { outlookCalendarProvider } from './providers/outlook_calendar/provider';

/**
 * Centralt provider-register. Adda nya providers här när vi bygger
 * dem (Google Calendar, GitHub, Slack m.fl.). Slug = stable
 * identifierare i DB:n och URL-vägar.
 */
const PROVIDERS: Record<string, OAuthProvider> = {
  [outlookCalendarProvider.meta.slug]: outlookCalendarProvider
};

export function getAppProvider(slug: string): OAuthProvider | null {
  return PROVIDERS[slug] ?? null;
}

export function listAppProviders(): OAuthProvider[] {
  return Object.values(PROVIDERS);
}
