import 'server-only';
import type { OAuthProvider, OAuthTokens, OAuthAccountProfile } from '../../types';

/**
 * Microsoft Outlook Calendar via Microsoft Graph.
 *
 * - OAuth 2.0 endpoints: login.microsoftonline.com/{tenant}
 *   där {tenant} = "common" för multi-tenant Azure-app (vår default).
 *   Sätt MOVEXUM_MICROSOFT_TENANT_ID för single-tenant.
 * - Scopes: User.Read + Calendars.Read + offline_access (för
 *   refresh_token). Read-only initialt — skrivning kräver separat
 *   DPIA (CLAUDE.md § 10.2).
 * - Datalokalisering: Microsoft Graph väljer EU-region automatiskt
 *   baserat på användarens hem-tenant. För svenska skol/myndighets-
 *   tenants ligger datat i EU. Dokumenteras i CLAUDE.md § 11.3
 *   (ny rad för outlook_calendar).
 */

const MICROSOFT_AUTH_BASE = 'https://login.microsoftonline.com';

const SCOPES = ['User.Read', 'Calendars.Read', 'offline_access'] as const;

function tenantSegment(): string {
  return process.env.MOVEXUM_MICROSOFT_TENANT_ID || 'common';
}

export const outlookCalendarProvider: OAuthProvider = {
  meta: {
    slug: 'outlook_calendar',
    title: 'Microsoft Outlook Calendar',
    blurb:
      'Koppla din Outlook-kalender för att se kommande möten direkt på /idag. Read-only ' +
      'via Microsoft Graph — vi skriver aldrig nya händelser.',
    residency: 'EU (Microsoft Graph, hem-tenantens region)',
    riskClass: 'begränsad',
    scopes: SCOPES,
    detailPath: '/integrationer/outlook-calendar'
  },
  endpoints: {
    authorize: `${MICROSOFT_AUTH_BASE}/${tenantSegment()}/oauth2/v2.0/authorize`,
    token: `${MICROSOFT_AUTH_BASE}/${tenantSegment()}/oauth2/v2.0/token`
  },

  getClientId(): string {
    const v = process.env.MOVEXUM_MICROSOFT_CLIENT_ID;
    if (!v) {
      throw new Error(
        'MOVEXUM_MICROSOFT_CLIENT_ID saknas — registrera en app i Azure AD och sätt env-varen.'
      );
    }
    return v;
  },

  getClientSecret(): string {
    const v = process.env.MOVEXUM_MICROSOFT_CLIENT_SECRET;
    if (!v) {
      throw new Error('MOVEXUM_MICROSOFT_CLIENT_SECRET saknas i miljövariablerna.');
    }
    return v;
  },

  buildAuthorizeUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: this.getClientId(),
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
      // `prompt=select_account` så användaren får välja konto explicit
      // — viktigt om de har både privat och jobb-Microsoft i samma browser.
      prompt: 'select_account'
    });
    return `${this.endpoints.authorize}?${params.toString()}`;
  },

  async fetchProfile(tokens: OAuthTokens): Promise<OAuthAccountProfile | null> {
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          accept: 'application/json'
        }
      });
      if (!res.ok) return null;
      const json = (await res.json()) as Record<string, unknown>;
      const email =
        (typeof json.userPrincipalName === 'string' ? json.userPrincipalName : null) ||
        (typeof json.mail === 'string' ? json.mail : null);
      const displayName = typeof json.displayName === 'string' ? json.displayName : null;
      const label = email || displayName || 'Microsoft-konto';
      return { label };
    } catch {
      return null;
    }
  }
};
