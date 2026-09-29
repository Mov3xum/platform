// Single source of truth for resolving the PocketBase base URL.
//
// We run separate staging and production PocketBase instances. NODE_ENV is
// 'production' in BOTH deployed containers, so it can't distinguish them —
// instead each deployment sets MOVEXUM_ENV (staging | production) in Coolify
// and we pick the matching _STAGING / _PRODUCTION env pair.
//
// Resolution order (server URL):
//   POCKETBASE_URL_<TARGET>  ->  POCKETBASE_URL (legacy/local)
//   ->  NEXT_PUBLIC_POCKETBASE_URL_<TARGET>  ->  NEXT_PUBLIC_POCKETBASE_URL
//   ->  localhost
// The NEXT_PUBLIC_* fallbacks exist because a deploy that only configures the
// public PocketBase URL (e.g. via .env.production) would otherwise leave the
// server side on the container default and fail every server action. The
// dedicated server vars still win when set.
// Public file URL falls back to the server URL when no public var is set.
//
// Default target is 'staging' when MOVEXUM_ENV is unset/unknown: a
// misconfigured deploy then talks to staging rather than risking writes to
// production data.
//
// RUNTIME, NOT BUILD TIME (incident 2026-09, produktion). Next.js inlinar
// `process.env.NEXT_PUBLIC_*` som statisk medlemsåtkomst vid BYGGET — även i
// serverbundlar. Med `process.env.NEXT_PUBLIC_POCKETBASE_URL` i koden bakades
// värdet ur apps/web/.env.production in i GHCR-imagen, och ett värde satt i
// Coolify vid runtime ignorerades tyst: när staging-PB:s gamla sslip-domän
// togs bort föll produktions-webben ner på den inbakade, döda adressen
// ("404 page not found" från proxyn → vilseledande "users saknas"). Därför
// läses ALLA variabler här via `readEnv` (beräknad nyckel, som Next inte
// kan inlina) så att Coolify-env alltid vinner över build-defaulten.

export type PbEnvTarget = 'staging' | 'production';

type EnvSource = Record<string, string | undefined>;

/** Läser en env-variabel utan att Next.js kan inlina den vid bygget. */
function readEnv(source: EnvSource, name: string): string | undefined {
  const key = String(name);
  return source[key];
}

export function resolvePbEnvTarget(source: EnvSource = process.env): PbEnvTarget {
  const v = (readEnv(source, 'MOVEXUM_ENV') || '').trim().toLowerCase();
  if (v === 'production' || v === 'prod') return 'production';
  return 'staging';
}

// Staging-PB:s publika adress (Coolify-domän på PB-staging-resursen). Bara en
// SISTA utväg när ingen env alls är satt — en produktions-deploy ska aldrig
// hamna här (se health-endpointen /api/health för vad som faktiskt resolvats).
export const STAGING_PB_FALLBACK = 'https://pb-staging.app.movexum.se';

function normalizeServerCandidate(value: string | undefined, nodeEnv: string | undefined): string | undefined {
  const v = (value || '').trim();
  if (!v) return undefined;
  // In production Dockerfile deploys the compose-only hostname
  // "pocketbase:8080" is unreachable and causes recurring auth outages.
  if (nodeEnv === 'production' && /https?:\/\/pocketbase:8080\/?$/i.test(v)) {
    return undefined;
  }
  return v;
}

function localDefault(nodeEnv: string | undefined): string {
  // In containerized staging/production deploys we often run ONLY the web app
  // image (no compose service named "pocketbase"). Falling back to
  // http://pocketbase:8080 makes auth fail hard with "Kunde inte nå
  // PocketBase". Default to staging PB URL instead when env is missing,
  // matching the documented safety policy in this file.
  return nodeEnv === 'production' ? STAGING_PB_FALLBACK : 'http://localhost:8080';
}

/** Ren resolution (enhetstestad) — `source` är normalt `process.env`. */
export function resolveServerPbUrl(source: EnvSource = process.env): string {
  const nodeEnv = readEnv(source, 'NODE_ENV');
  const suffix = resolvePbEnvTarget(source).toUpperCase(); // STAGING | PRODUCTION
  return (
    normalizeServerCandidate(readEnv(source, `POCKETBASE_URL_${suffix}`), nodeEnv) ||
    normalizeServerCandidate(readEnv(source, 'POCKETBASE_URL'), nodeEnv) ||
    normalizeServerCandidate(readEnv(source, `NEXT_PUBLIC_POCKETBASE_URL_${suffix}`), nodeEnv) ||
    normalizeServerCandidate(readEnv(source, 'NEXT_PUBLIC_POCKETBASE_URL'), nodeEnv) ||
    localDefault(nodeEnv)
  );
}

/** Ren resolution av den publika (klient-/fil-)URL:en. */
export function resolvePublicPbUrl(source: EnvSource = process.env): string {
  const suffix = resolvePbEnvTarget(source).toUpperCase();
  return (
    readEnv(source, `NEXT_PUBLIC_POCKETBASE_URL_${suffix}`) ||
    readEnv(source, 'NEXT_PUBLIC_POCKETBASE_URL') ||
    resolveServerPbUrl(source)
  );
}

/**
 * Vilka env-nycklar som faktiskt bidrog till resolutionen — för
 * `/api/health` så en felkonfigurerad deploy syns ("resolvad via fallback",
 * inte via `POCKETBASE_URL_PRODUCTION`). Bara nyckelnamn, aldrig värden.
 */
export function describePbUrlSource(source: EnvSource = process.env): { target: PbEnvTarget; via: string } {
  const nodeEnv = readEnv(source, 'NODE_ENV');
  const target = resolvePbEnvTarget(source);
  const suffix = target.toUpperCase();
  const candidates = [
    `POCKETBASE_URL_${suffix}`,
    'POCKETBASE_URL',
    `NEXT_PUBLIC_POCKETBASE_URL_${suffix}`,
    'NEXT_PUBLIC_POCKETBASE_URL'
  ];
  for (const key of candidates) {
    if (normalizeServerCandidate(readEnv(source, key), nodeEnv)) return { target, via: key };
  }
  return { target, via: nodeEnv === 'production' ? 'fallback:STAGING_PB_FALLBACK' : 'fallback:localhost' };
}

/** Vilken miljö (`MOVEXUM_ENV`) URL-resolutionen kör mot — för diagnostik. */
export function getPbEnvTarget(): PbEnvTarget {
  return resolvePbEnvTarget(process.env);
}

export function getServerPbUrl(): string {
  return resolveServerPbUrl(process.env);
}

export function getPublicPbUrl(): string {
  return resolvePublicPbUrl(process.env);
}
