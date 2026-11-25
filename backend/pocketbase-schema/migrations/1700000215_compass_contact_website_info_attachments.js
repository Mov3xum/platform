/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — hemsida, övrig information och bilagor i avsnittet
// "Dina uppgifter" (CLAUDE.md § 23.12, 2026-11). De mer drivna idébärarna
// har ofta ett pitch deck eller annat underlag de vill bifoga, en hemsida
// och lite extra att berätta.
//
//   compass_leads:
//     • website (text ≤ 300) — normaliserad http(s)-adress (normalizeWebsite).
//     • other_info (text ≤ 3000) — fritext, personnummer-saneras i koden.
//
//   compass_lead_attachments (ny): uppladdade filer från en publik modul.
//     tenant (cascade), lead (cascade, tomt tills flödet slutförs),
//     module_slug, session_hash (SHA-256 av flödets sessionstoken — kopplar
//     filen till rätt lead vid slutförandet), file (PROTECTED, 25 MB,
//     PDF/Office/bild), filename, mime, size_bytes, autodate.
//     list/view/delete = kompass-personal (admin/incubator_lead/coach) i
//     tenanten; create/update = NULL (bara servern — den publika routen har
//     ingen session). Okopplade filer gallras av retention_tick efter 2 dygn.
//
//   compass_modules.contact_fields: befintliga INTAG-moduler med lagrad
//   konfiguration får de tre nya fälten som "Frivillig" (bara när nyckeln
//   saknas — ett uttryckligt val rörs aldrig). Moduler utan lagrad
//   konfiguration (legacy) och enkäter rörs inte.
//
// Compass är migration-only (§ 23.4) men compass_leads/compass_lead_attachments
// speglas i setup-via-api.mjs. Oföränderlig migration (§ 10.3 A.8.32).

const COMPASS_STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach")';
const STAFF_RULE = `@request.auth.id != "" && @request.auth.tenant = tenant && ${COMPASS_STAFF}`;

const MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/png',
  'image/jpeg',
  'image/webp'
];

const NEW_KEYS = ['website', 'other_info', 'attachments'];

migrate(
  (app) => {
    const leads = app.findCollectionByNameOrId('compass_leads');
    let changed = false;
    if (!leads.fields.getByName('website')) {
      leads.fields.add(new Field({ name: 'website', type: 'text', required: false, max: 300 }));
      changed = true;
    }
    if (!leads.fields.getByName('other_info')) {
      leads.fields.add(new Field({ name: 'other_info', type: 'text', required: false, max: 3000 }));
      changed = true;
    }
    if (changed) app.save(leads);

    let exists = true;
    try {
      app.findCollectionByNameOrId('compass_lead_attachments');
    } catch (e) {
      exists = false;
    }
    if (!exists) {
      const tenants = app.findCollectionByNameOrId('tenants');
      const col = new Collection({
        name: 'compass_lead_attachments',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'tenant', type: 'relation', required: true, collectionId: tenants.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
          { name: 'lead', type: 'relation', required: false, collectionId: leads.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
          { name: 'module_slug', type: 'text', required: false, max: 100 },
          { name: 'session_hash', type: 'text', required: false, max: 64 },
          {
            name: 'file',
            type: 'file',
            required: true,
            maxSelect: 1,
            maxSize: 25 * 1024 * 1024,
            mimeTypes: MIME_TYPES,
            protected: true
          },
          { name: 'filename', type: 'text', required: false, max: 200 },
          { name: 'mime', type: 'text', required: false, max: 120 },
          { name: 'size_bytes', type: 'number', required: false, min: 0 }
        ],
        indexes: [
          'CREATE INDEX idx_compass_lead_att_lead ON compass_lead_attachments (lead)',
          'CREATE INDEX idx_compass_lead_att_session ON compass_lead_attachments (tenant, module_slug, session_hash)'
        ],
        listRule: STAFF_RULE,
        viewRule: STAFF_RULE,
        createRule: null,
        updateRule: null,
        deleteRule: STAFF_RULE
      });
      app.save(col);
    }

    // Befintliga intag-moduler med lagrad konfiguration: nya fält som frivilliga.
    try {
      const rows = app.findRecordsByFilter('compass_modules', "contact_fields != ''", '', 0, 0);
      for (const r of rows) {
        if (String(r.getString('purpose') || '') === 'survey') continue;
        let cfg;
        try {
          cfg = JSON.parse(r.getString('contact_fields') || 'null');
        } catch (e) {
          cfg = null;
        }
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
        let touched = false;
        for (const k of NEW_KEYS) {
          if (!(k in cfg)) {
            cfg[k] = 'optional';
            touched = true;
          }
        }
        if (touched) {
          r.set('contact_fields', cfg);
          app.save(r);
        }
      }
    } catch (e) {
      // inga moduler — inget att uppdatera
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('compass_lead_attachments'));
    } catch (e) {
      /* ignore */
    }
    try {
      const leads = app.findCollectionByNameOrId('compass_leads');
      for (const name of ['website', 'other_info']) {
        const f = leads.fields.getByName(name);
        if (f) leads.fields.removeById(f.id);
      }
      app.save(leads);
    } catch (e) {
      /* ignore */
    }
  }
);
