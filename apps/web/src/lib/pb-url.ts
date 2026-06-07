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

function target(): 'staging' | 'production' {
  const v = (process.env.MOVEXUM_ENV || '').trim().toLowerCase();
  if (v === 'production' || v === 'prod') return 'production';
  return 'staging';
}

const STAGING_PB_FALLBACK =
  'https://pocketbase-r10nklch8dkune7s0flczb89.212.147.227.223.sslip.io';

function normalizeServerCandidate(value: string | undefined): string | undefined {
  const v = (value || '').trim();
  if (!v) return undefined;
  // In production Dockerfile deploys the compose-only hostname
  // "pocketbase:8080" is unreachable and causes recurring auth outages.
  if (process.env.NODE_ENV === 'production' && /https?:\/\/pocketbase:8080\/?$/i.test(v)) {
    return undefined;
  }
  return v;
}

function localDefault(): string {
  // In containerized staging/production deploys we often run ONLY the web app
  // image (no compose service named "pocketbase"). Falling back to
  // http://pocketbase:8080 makes auth fail hard with "Kunde inte nå
  // PocketBase". Default to staging PB URL instead when env is missing,
  // matching the documented safety policy in this file.
  return process.env.NODE_ENV === 'production'
    ? STAGING_PB_FALLBACK
    : 'http://localhost:8080';
}

export function getServerPbUrl(): string {
  const suffix = target().toUpperCase(); // STAGING | PRODUCTION
  return (
    normalizeServerCandidate(process.env[`POCKETBASE_URL_${suffix}`]) ||
    normalizeServerCandidate(process.env.POCKETBASE_URL) ||
    normalizeServerCandidate(process.env[`NEXT_PUBLIC_POCKETBASE_URL_${suffix}`]) ||
    normalizeServerCandidate(process.env.NEXT_PUBLIC_POCKETBASE_URL) ||
    localDefault()
  );
}

export function getPublicPbUrl(): string {
  const suffix = target().toUpperCase();
  return (
    process.env[`NEXT_PUBLIC_POCKETBASE_URL_${suffix}`] ||
    process.env.NEXT_PUBLIC_POCKETBASE_URL ||
    getServerPbUrl()
  );
}
