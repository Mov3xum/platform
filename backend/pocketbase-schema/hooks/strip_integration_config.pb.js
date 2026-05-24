/// <reference path="../pb_data/types.d.ts" />

// Defense-in-depth: scrub the encrypted-credentials blob from any
// tenant_integrations API response so it can never leak via the
// public REST surface even if a future RLS rule weakens.
//
// The orchestrator (apps/web/src/lib/integrations/sync.ts) reads
// credentials via the server-side PocketBase admin client, which
// bypasses these hooks.

onRecordEnrich((e) => {
  if (e.record && typeof e.record.set === 'function') {
    e.record.set('config', null);
  }
  e.next();
}, 'tenant_integrations');
