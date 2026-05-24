import 'server-only';

/**
 * Provider-agnostiskt ramverk för per-user OAuth-integrationer
 * (CLAUDE.md § 11.x, paralleller till `lib/integrations/` men på
 * användarnivå istället för tenant-nivå).
 *
 * Att lägga till en ny provider (Google Calendar, GitHub, Slack…)
 * består av:
 *   1. Skapa `lib/app-integrations/providers/<slug>/provider.ts`
 *      som exporterar ett `OAuthProvider`-objekt.
 *   2. Registrera providern i `lib/app-integrations/registry.ts`.
 *   3. Bygg ev. provider-specifika fetchers (calendar.ts, repos.ts …).
 *   4. Whitelista provider-domänen i CLAUDE.md § 11 risk-tabellen.
 */

/** Frisk-läsbar metadata om provider för UI och regelefterlevnad. */
export interface OAuthProviderMeta {
  /** Slug i DB:n. Stable, snake_case. */
  slug: string;
  /** UI-titel ("Microsoft Outlook Calendar"). */
  title: string;
  /** Kort beskrivning för kortet på /integrationer. */
  blurb: string;
  /** Datalokalisering — exakt land/region, "EU", "EU/global" osv. */
  residency: string;
  /** EU AI Act-riskklass (CLAUDE.md § 11.3). */
  riskClass: 'minimal' | 'begränsad' | 'högrisk';
  /** Vilka OAuth-scopes vi begär (för transparensbannrar). */
  scopes: readonly string[];
  /** URL-väg under /integrationer för providerns detaljsida. */
  detailPath: string;
}

/** OAuth 2.0 authorization endpoint-config. */
export interface OAuthEndpoints {
  /** Authorization-endpoint (där användaren skickas för consent). */
  authorize: string;
  /** Token-endpoint (där vi byter code mot access_token). */
  token: string;
  /** Frivillig revoke-endpoint för att invalidera tokens vid disconnect. */
  revoke?: string;
}

/** Plaintext-token strukturen vi förväntar oss efter code-exchange. */
export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  /** ISO 8601-tidsstämpel när access_token slutar gälla. */
  expires_at: string;
  scope?: string;
  token_type?: string;
}

/**
 * Lättviktigt profil-objekt som hämtas direkt efter OAuth för att
 * kunna visa "Ansluten som <e-post>" i UI utan att dekryptera tokens
 * varje request. Sparas i `account_label`-fältet (frisktext).
 */
export interface OAuthAccountProfile {
  /** Det vi visar i UI:t (e-postadress, användarnamn etc.). */
  label: string;
}

/**
 * Provider-implementation. En per tredjepartstjänst.
 */
export interface OAuthProvider {
  meta: OAuthProviderMeta;
  endpoints: OAuthEndpoints;

  /**
   * Returnerar OAuth client_id från miljövariabel. Provider väljer
   * vilken env-nyckel. Throw vid saknad config så aktiveringen
   * felar tydligt istället för att gå tyst sönder vid callback.
   */
  getClientId(): string;
  /** Som getClientId men för client_secret. */
  getClientSecret(): string;

  /**
   * Bygg authorize-URL:en användaren skickas till. Implementationen
   * lägger till response_type=code, scope, state, redirect_uri,
   * eventuell tenant/instance-parameter, samt eventuellt PKCE.
   */
  buildAuthorizeUrl(args: { state: string; redirectUri: string }): string;

  /**
   * Hämtar användarens profil efter lyckad token-exchange.
   * Får färska access_token + http-baserade headers för att slå
   * mot provider's "me"-endpoint. Fail-soft: returnera null om
   * profilfetchen failar — vi sätter `account_label` till provider-
   * slug som fallback istället för att blockera hela koppligen.
   */
  fetchProfile(tokens: OAuthTokens): Promise<OAuthAccountProfile | null>;
}
