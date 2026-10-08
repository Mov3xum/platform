/// <reference path="../pb_data/types.d.ts" />

// Notifikationssystemet v2 (CLAUDE.md § 50) — grund och säkerhet.
//
// 1. SÄKERHET: `notifications.createRule` blir NULL (bara superuser). Den
//    gamla regeln `auth && (actor = "" || actor = auth.id)` lät vilken
//    inloggad användare som helst skapa notiser till vilken användare som
//    helst — även i en annan tenant och, med tom actor, maskerade som
//    systemnotiser med valfri länk (nätfiske). Notiser skapas numera BARA av
//    servern (`lib/notifications-server.ts`) med den cachade superusern,
//    efter att roll, tenant och mottagare verifierats i koden.
// 2. `kind` blir TEXT i stället för select — giltigheten kontrolleras mot
//    katalogen i `packages/shared/src/notifications.ts`, så en ny notistyp
//    kräver ingen schemaändring. PB 0.23.4 vägrar byta typ på ett fält med
//    samma id ("Field type cannot be changed", verifierat lokalt), så bytet
//    görs i två steg: snapshot av värdena → fältet tas bort → nytt textfält →
//    värdena skrivs tillbaka. Allt i migrationens transaktion.
// 3. Nya fält: category, priority, entity_type/entity_id (vad notisen gäller
//    — används för "tysta"), group_key + count (sammanslagning av olästa
//    notiser om samma sak), seen_at (klockans siffra nollas när panelen
//    öppnas), latest_at (sortering — en sammanslagen notis flyttas upp),
//    dedupe_key (unikt per användare → påminnelser skickas aldrig två gånger).
// 4. `tenant` får cascadeDelete (GDPR art. 17 — notiser städas med tenanten).
// 5. Ny collection `notification_preferences` — en rad per användare med
//    valen under Mitt konto → Notiser. STRIKT ägaren-bara (som chat_threads):
//    `users.viewRule` låter alla i tenanten läsa varandra, så inställningarna
//    ligger inte på `users`.
//
// Riskklass n/a (ingen AI-inferens). Inga personuppgifter utöver interna
// användarrelationer. Nytt, oföränderligt filnummer (§ 10.3 A.8.32).
// Speglas i setup-via-api.mjs och asserteras i verify-baseline.mjs.

const ANY_AUTH = '@request.auth.id != ""';
const IS_OWNER = '@request.auth.id = user';
// Mottagaren får BARA markera läst/sedd — alla andra fält är låsta. Utan
// låset kunde en användare PATCH:a sin egen notis till en annan användare i
// en annan tenant med valfri avsändare/text och därmed kringgå createRule.
const LOCKED_FIELDS = [
  'user', 'tenant', 'kind', 'actor', 'mission', 'comment', 'payload_json', 'category',
  'priority', 'entity_type', 'entity_id', 'group_key', 'count', 'dedupe_key', 'latest_at'
];
const NOTIFICATION_UPDATE_RULE =
  `${ANY_AUTH} && ${IS_OWNER} && ` + LOCKED_FIELDS.map((f) => `@request.body.${f}:isset = false`).join(' && ');

function addField(collection, def) {
  if (collection.fields.getByName(def.name)) return false;
  collection.fields.add(new Field(def));
  return true;
}

function addIndex(collection, sql, name) {
  const current = Array.isArray(collection.indexes) ? Array.from(collection.indexes) : [];
  if (current.some((i) => String(i).includes(name))) return;
  collection.indexes = [...current, sql];
}

migrate(
  (app) => {
    const notifications = app.findCollectionByNameOrId('notifications');

    // ── 2. kind: select → text (snapshot → drop → add → återställ) ─────────
    const kindField = notifications.fields.getByName('kind');
    const snapshot = [];
    if (kindField && kindField.type !== 'text') {
      try {
        const rows = app.findRecordsByFilter('notifications', 'id != ""', '', 0, 0);
        for (const r of rows) {
          const value = r.get('kind');
          if (value) snapshot.push({ id: r.id, kind: String(value) });
        }
      } catch (e) {
        /* tom tabell */
      }
      notifications.fields.removeById(kindField.id);
      app.save(notifications);
      // Valfritt under återställningen; görs obligatoriskt i slutet.
      notifications.fields.add(new Field({ name: 'kind', type: 'text', required: false, min: 0, max: 60 }));
    }

    // ── 3. Nya fält ────────────────────────────────────────────────────────
    addField(notifications, { name: 'category', type: 'text', required: false, max: 40 });
    addField(notifications, { name: 'priority', type: 'text', required: false, max: 20 });
    addField(notifications, { name: 'entity_type', type: 'text', required: false, max: 40 });
    addField(notifications, { name: 'entity_id', type: 'text', required: false, max: 64 });
    addField(notifications, { name: 'group_key', type: 'text', required: false, max: 160 });
    addField(notifications, { name: 'count', type: 'number', required: false, onlyInt: true, min: 0, max: 999 });
    addField(notifications, { name: 'seen_at', type: 'date', required: false });
    addField(notifications, { name: 'latest_at', type: 'date', required: false });
    addField(notifications, { name: 'dedupe_key', type: 'text', required: false, max: 160 });

    // ── 4. tenant cascade ──────────────────────────────────────────────────
    const tenantField = notifications.fields.getByName('tenant');
    if (tenantField) tenantField.cascadeDelete = true;

    // ── 1. createRule = NULL (bara servern skapar notiser) + fältlåst update ─
    notifications.createRule = null;
    notifications.updateRule = NOTIFICATION_UPDATE_RULE;

    addIndex(
      notifications,
      'CREATE INDEX idx_notifications_user_group ON notifications (user, group_key)',
      'idx_notifications_user_group'
    );
    addIndex(
      notifications,
      "CREATE UNIQUE INDEX idx_notifications_user_dedupe ON notifications (user, dedupe_key) WHERE dedupe_key != ''",
      'idx_notifications_user_dedupe'
    );

    app.save(notifications);

    // Återställ `kind` efter typbytet, därefter obligatoriskt igen.
    for (const snap of snapshot) {
      try {
        const rec = app.findRecordById('notifications', snap.id);
        rec.set('kind', snap.kind);
        app.saveNoValidate(rec);
      } catch (e) {
        /* raderad mellan stegen */
      }
    }
    if (snapshot.length > 0 || (kindField && kindField.type !== 'text')) {
      // Rader utan värde (ska inte finnas — fältet var obligatoriskt) får en neutral typ.
      try {
        const empty = app.findRecordsByFilter('notifications', "kind = ''", '', 0, 0);
        for (const r of empty) {
          r.set('kind', 'assigned');
          app.saveNoValidate(r);
        }
      } catch (e) {
        /* inga */
      }
      const refreshed = app.findCollectionByNameOrId('notifications');
      const kindText = refreshed.fields.getByName('kind');
      if (kindText) {
        kindText.required = true;
        kindText.min = 1;
        app.save(refreshed);
      }
    }

    // Backfill av latest_at (sortering).
    try {
      const rows = app.findRecordsByFilter('notifications', "latest_at = ''", '', 0, 0);
      for (const r of rows) {
        const created = r.get('created');
        if (!created) continue;
        r.set('latest_at', created);
        app.saveNoValidate(r);
      }
    } catch (e) {
      /* fältet/raderna saknas — appen faller tillbaka på created */
    }

    // ── 5. notification_preferences ────────────────────────────────────────
    let prefs = null;
    try {
      prefs = app.findCollectionByNameOrId('notification_preferences');
    } catch (e) {
      prefs = null;
    }
    if (!prefs) {
      const usersCol = app.findCollectionByNameOrId('users');
      const tenantsCol = app.findCollectionByNameOrId('tenants');
      prefs = new Collection({
        id: 'notification_preferences_collection',
        name: 'notification_preferences',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          {
            name: 'tenant',
            type: 'relation',
            required: true,
            collectionId: tenantsCol.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1
          },
          {
            name: 'user',
            type: 'relation',
            required: true,
            collectionId: usersCol.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1
          },
          { name: 'settings', type: 'json', required: false, maxSize: 30000 }
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_notification_preferences_user ON notification_preferences (user)'
        ],
        listRule: `${ANY_AUTH} && ${IS_OWNER}`,
        viewRule: `${ANY_AUTH} && ${IS_OWNER}`,
        // Bara auth-fält + skalär ägarcheck (§ 21.3) — ingen roll, ingen tenant-join.
        createRule: `${ANY_AUTH} && @request.auth.tenant != "" && ${IS_OWNER} && @request.body.tenant = @request.auth.tenant`,
        updateRule: `${ANY_AUTH} && ${IS_OWNER} && @request.body.user:isset = false && @request.body.tenant:isset = false`,
        deleteRule: `${ANY_AUTH} && ${IS_OWNER}`
      });
      app.save(prefs);
    }
  },
  (app) => {
    try {
      const prefs = app.findCollectionByNameOrId('notification_preferences');
      app.delete(prefs);
    } catch (e) {
      /* saknas */
    }
    const notifications = app.findCollectionByNameOrId('notifications');
    notifications.createRule = '@request.auth.id != "" && (actor = "" || @request.auth.id = actor)';
    notifications.updateRule = '@request.auth.id != "" && @request.auth.id = user';
    for (const name of [
      'category',
      'priority',
      'entity_type',
      'entity_id',
      'group_key',
      'count',
      'seen_at',
      'latest_at',
      'dedupe_key'
    ]) {
      const f = notifications.fields.getByName(name);
      if (f) notifications.fields.removeById(f.id);
    }
    notifications.indexes = (Array.isArray(notifications.indexes) ? Array.from(notifications.indexes) : []).filter(
      (i) => !String(i).includes('idx_notifications_user_group') && !String(i).includes('idx_notifications_user_dedupe')
    );
    // `kind` lämnas som text vid nedrullning: nya typer kan inte representeras
    // av den gamla select-listan och skulle annars göra raderna ogiltiga.
    app.save(notifications);
  }
);
