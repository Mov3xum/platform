/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 36.3 / § 61 — backfill av `users.enabled_modules` för modulen
// `spark`. En sparad allow-lista får aldrig en ny modul automatiskt, så
// sidan skulle annars finnas men saknas i sidmenyn (precedens 1700000187).
// Idempotent: lägger bara till, tar aldrig bort, rör inte `null`-listor.
// Rolltabellen MÅSTE spegla DEFAULT_MODULES_BY_ROLE i
// packages/shared/src/module-access.ts. Ingen personuppgift, inget schema.

const ROLES_WITH_MODULE = {
  spark: ['admin', 'incubator_lead', 'coach', 'observer', 'partner']
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
        // best-effort per konto
      }
    }
  },
  (app) => {
    // Ingen rollback (se 1700000187).
  }
);
