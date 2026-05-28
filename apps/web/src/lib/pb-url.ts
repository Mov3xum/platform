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

function localDefault(): string {
  return process.env.NODE_ENV === 'production'
    ? 'http://pocketbase:8080'
    : 'http://localhost:8080';
}

export function getServerPbUrl(): string {
  const suffix = target().toUpperCase(); // STAGING | PRODUCTION
  return (
    process.env[`POCKETBASE_URL_${suffix}`] ||
    process.env.POCKETBASE_URL ||
    process.env[`NEXT_PUBLIC_POCKETBASE_URL_${suffix}`] ||
    process.env.NEXT_PUBLIC_POCKETBASE_URL ||
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
