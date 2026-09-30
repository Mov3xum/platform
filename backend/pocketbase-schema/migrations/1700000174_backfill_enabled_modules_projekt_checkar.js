/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 36.3 / § 46 — backfill av `users.enabled_modules` för modulerna
// `projekt` (Projekt: finansieringsprojekt + arbetspaket) och `checkar`
// (Stödcheckar), som lades till i DEFAULT_MODULES_BY_ROLE i § 46-releasen.
//
// Bakgrund: sidofältet följer en per-användare-ALLOW-lista. Ett konto vars
// lista redan var sparad (skapat via "Ny användare" eller justerat i
// modulväljaren) innan modulerna fanns får dem ALDRIG automatiskt — rollens
// standard gäller bara vid kontoskapande (resolveEnabledModules). Följden var
// att "Projekt" saknades i sidmenyn trots att sidan /projekt fanns
// (incident 2026-09-30). `null`-listor rörs INTE (de följer rollen redan).
//
// Idempotent: lägger bara till saknade id:n, tar aldrig bort något, och bara
// för roller vars standard innehåller modulen (samma tabell som
// packages/shared/src/module-access.ts — håll dem i synk).
//
// GDPR: ingen personuppgift (bara modul-id:n). Riskklass n/a. Ren
// databackfill — inget schema ändras, därför ingen spegling i
// setup-via-api.mjs.

const ROLES_WITH_MODULE = {
  projekt: ['admin', 'incubator_lead', 'coach', 'observer'],
  checkar: ['admin', 'incubator_lead', 'coach', 'mentor', 'observer', 'startup_member']
};

function readEnabledModules(rec) {
  let raw = null;
  try {
    raw = rec.getString('enabled_modules');
  } catch (e) {
    raw = null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      /* fall through */
    }
  }
  try {
    const v = rec.get('enabled_modules');
    if (v == null) return null;
    const parsed = JSON.parse(JSON.stringify(v));
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function readRoles(rec) {
  try {
    const roles = rec.getStringSlice('roles');
    return Array.isArray(roles) ? roles : Array.from(roles || []);
  } catch (e) {
    return [];
  }
}

migrate(
  (app) => {
    let users;
    try {
      users = app.findAllRecords('users');
    } catch (e) {
      return;
    }
    for (const rec of users) {
      const stored = readEnabledModules(rec);
      // Ingen lagrad lista ⇒ rollen styr redan (allt rollen tillåter). Rör inte.
      if (!stored) continue;
      const roles = readRoles(rec);
      const next = stored.filter((v) => typeof v === 'string');
      let changed = false;
      for (const moduleId of Object.keys(ROLES_WITH_MODULE)) {
        if (next.includes(moduleId)) continue;
        if (!roles.some((r) => ROLES_WITH_MODULE[moduleId].includes(r))) continue;
        next.push(moduleId);
        changed = true;
      }
      if (!changed) continue;
      try {
        rec.set('enabled_modules', next);
        app.save(rec);
      } catch (e) {
        // best-effort per konto — ett fel ska inte stoppa övriga
      }
    }
  },
  (app) => {
    // Ingen rollback: att ta bort modulerna igen skulle även träffa konton
    // där en människa medvetet bockat i dem efter migrationen.
  }
);
