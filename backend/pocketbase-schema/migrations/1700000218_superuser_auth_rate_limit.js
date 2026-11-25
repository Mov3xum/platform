/// <reference path="../pb_data/types.d.ts" />

// Säkerhetsgranskning 2026-11-15 — inloggningsgräns för superuser direkt mot
// PocketBase (CLAUDE.md § 21.8).
//
// PocketBase har en egen publik adress och webbappens inloggningsgränser gäller
// bara Next-routen. Med PB:s rate-limit avstängd kunde `_superusers` (admin för
// hela databasen) gissas obegränsat. Den här migrationen slår på PB:s
// rate-limit med EN regel: `_superusers:auth`, 10 försök per minut och IP.
//
// PB:s standardregler (`*:auth` 2/3 s, `*:create`, `/api/batch`, `/api/`) tas
// bort: alla vanliga inloggningar och skrivningar kommer från web-containerns
// IP och skulle strypas (§ 23.2-incidenten). Egna regler som en administratör
// lagt till behålls. Användarinloggningen skyddas av auth-gaten
// (hooks/auth_gate.pb.js). Spegel av desiredRateLimits() i
// scripts/security-rules.mjs; setup-via-api.mjs och verify-baseline.mjs
// håller och asserterar samma läge.

const SUPERUSER_LABEL = '_superusers:auth';
const DEFAULT_LABELS = ['*:auth', '*:create', '/api/batch', '/api/'];

migrate(
  (app) => {
    const settings = app.settings();
    const current = settings.rateLimits.rules || [];
    const kept = [];
    for (let i = 0; i < current.length; i++) {
      const label = String(current[i].label);
      if (DEFAULT_LABELS.indexOf(label) >= 0 || label === SUPERUSER_LABEL) continue;
      kept.push({
        label: label,
        audience: String(current[i].audience || ''),
        duration: Number(current[i].duration),
        maxRequests: Number(current[i].maxRequests)
      });
    }
    kept.push({ label: SUPERUSER_LABEL, audience: '', duration: 60, maxRequests: 10 });
    settings.rateLimits.enabled = true;
    settings.rateLimits.rules = kept;
    app.save(settings);
  },
  (_app) => {
    // No-op: att stänga av gränsen återinför sårbarheten.
  }
);
