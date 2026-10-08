/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 21.8 / § 10.3 A.8.x / § 10.4 (SOC 2 availability) — delat,
// processöverskridande tillstånd för horisontell skalning (flera
// web-containrar bakom lastbalanseraren).
//
//   rate_limits  ← räknare för rate-limitern (lib/rate-limit.ts). `key` är en
//                  HMAC/SHA-256 av den logiska nyckeln — ALDRIG e-post/IP i
//                  klartext (GDPR § 5). Raderna är kortlivade (fönster ≤ 1 h)
//                  och städas opportunistiskt av appen.
//   app_locks    ← distribuerade lås (lib/distributed-lock.ts). En rad = ett
//                  taget lås; unikt index på `key` avgör vem som vann.
//                  `expires_at` gör att ett lås från en död container går ut.
//
// ALLA API-regler är null (endast superuser): appen når kollektionerna bara
// via den cachade superuser-klienten, aldrig med en användartoken. Ingen
// tenant-kolumn — nycklarna är redan scopade av anroparen. Autodate
// explicit (§ 28.5). Speglas i setup-via-api.mjs, asserteras i
// verify-baseline.mjs och är denylistade för chattens query-verktyg.

migrate(
  (app) => {
    let rateLimits;
    try {
      rateLimits = app.findCollectionByNameOrId('rate_limits');
    } catch (e) {
      rateLimits = null;
    }
    if (!rateLimits) {
      rateLimits = new Collection({
        id: 'rate_limits_collection',
        name: 'rate_limits',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'key', type: 'text', required: true, min: 1, max: 200 },
          { name: 'count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'reset_at', type: 'date', required: true }
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_rate_limits_key ON rate_limits (key)',
          'CREATE INDEX idx_rate_limits_reset_at ON rate_limits (reset_at)'
        ],
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null
      });
      app.save(rateLimits);
    }

    let locks;
    try {
      locks = app.findCollectionByNameOrId('app_locks');
    } catch (e) {
      locks = null;
    }
    if (!locks) {
      locks = new Collection({
        id: 'app_locks_collection',
        name: 'app_locks',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'key', type: 'text', required: true, min: 1, max: 200 },
          { name: 'owner', type: 'text', required: true, min: 1, max: 200 },
          { name: 'expires_at', type: 'date', required: true }
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_app_locks_key ON app_locks (key)',
          'CREATE INDEX idx_app_locks_expires_at ON app_locks (expires_at)'
        ],
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null
      });
      app.save(locks);
    }
  },
  (app) => {
    for (const name of ['app_locks', 'rate_limits']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* ignore */
      }
    }
  }
);
