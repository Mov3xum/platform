/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 34 — Mötesläge i chatten. Ett pågående/avslutat möte lagras som
// EN rad: segmenterat transkript (bara TEXT — ljudet är transient och lagras
// aldrig, § 31-principen), valt bolag, samtyckesstämpel och status.
//
// STRIKT ägaren-bara (samma klass som chat_threads/user_files § 17.2): bara
// coachen som spelade in ser transkriptet — även admin är utestängd. Raden är
// ARBETSDATA, inte arkiv: när protokollet sparats på bolagskortet purgas den
// (lagringsminimering GDPR § 5); osparade möten purgas efter 7 dagar
// (MEETING_STALE_DAYS i @platform/shared).
//
// Kollektionen är denylistad i lib/ai/redaction.ts → generiska
// query_collection exponerar den ALDRIG. Owner-only ⇒ migration-only (samma
// precedens som user_files/user_file_chunks, § 27 — speglas inte i
// setup-via-api/verify-baseline, som bevakar tenant-isolerings-invarianter).
//
// PB v0.23 auto-lägger INTE created/updated vid `new Collection(...)`
// (§ 28.5) → autodate-fälten läggs explicit så sort '-updated' fungerar.

const ANY_AUTH = '@request.auth.id != ""';
const OWNER_MATCH = '@request.auth.id = owner';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'meeting_transcripts_col',
      name: 'meeting_transcripts',
      type: 'base',
      fields: [
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
          name: 'owner',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // Valfritt tills coachen väljer bolag. Ingen cascade — raderas bolaget
        // mitt i ett möte lever transkriptet vidare (och purgas som vanligt).
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: startupsCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['recording', 'ended', 'saved', 'discarded']
        },
        { name: 'title', type: 'text', required: false, max: 200 },
        // MeetingSegment[] (@platform/shared meeting.ts): { index, text, at?,
        // speaker? }. 2 MB-tak — 3 h tal är ~200–300 KB text, god marginal.
        { name: 'segments', type: 'json', required: false, maxSize: 2000000 },
        // Stämpel från samtyckesgrinden (GDPR art. 7) — sätts INNAN inspelning.
        { name: 'consent_confirmed_at', type: 'date', required: false },
        { name: 'started_at', type: 'date', required: false },
        { name: 'ended_at', type: 'date', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE INDEX idx_mt_owner ON meeting_transcripts (owner)',
        'CREATE INDEX idx_mt_tenant ON meeting_transcripts (tenant)',
        'CREATE INDEX idx_mt_owner_status ON meeting_transcripts (owner, status)'
      ],
      // STRIKT ägaren-bara på ALLA operationer — ingen staff-läsning.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('meeting_transcripts'));
    } catch (e) {
      /* ignore */
    }
  }
);
