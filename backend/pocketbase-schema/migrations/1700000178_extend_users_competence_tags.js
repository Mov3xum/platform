/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29.7 — Kompetens-hashtags med nivå + belastningsmedveten
// teammatchning.
//
//   users.competence_tags        ← json: [{ tag, area, level }] — personens
//                                   hashtags (specialiseringar under de 14
//                                   kompetensområdena) med nivå
//                                   contribute | strong | expert.
//   users.development_interests  ← json: [slug, …] — taggar personen VILL
//                                   utvecklas inom (tvärfunktionellt lärande).
//   competence_tags (ny)         ← tenant-gemensam vokabulär: seedade taggar +
//                                   taggar kollegor lagt till i profilen
//                                   (status suggested) så autocompleten
//                                   konvergerar språket. Ledningen kan
//                                   godkänna/döpa om/ta bort.
//
// `users.competences` (select, 1700000134) behålls och HÄRLEDS ur taggarna
// av profil-actionen, så befintliga ytor (teampanel, kandidatlista) fungerar
// oförändrat. Fältlåset i 1700000174 låser inte de nya fälten → självservice
// via `@request.auth.id = id` fungerar.
//
// GDPR: yrkeskompetens (berättigat intresse, bemanning av tvärfunktionella
// team), inte art. 9. Taggar får aldrig bära personuppgifter — slug-
// normaliseringen i @platform/shared avvisar personnummer-mönster och UI:t
// säger det. `users` förblir denylistad för chatten; `competence_tags`
// innehåller inga personuppgifter (slug/etikett/område).
//
// RLS (§ 21.3): list/view staff/observer (intern bemanningsdata), createRule
// roll-lös men body-låst (bara `suggested`, eget `created_by`, egen tenant —
// rollen enforce:as i server-actionen), update/delete ledning.
// Autodate explicit (§ 28.5). Speglas i setup-via-api.mjs, asserteras i
// verify-baseline.mjs. Seed-listan MÅSTE spegla COMPETENCE_TAG_SEED i
// packages/shared/src/competence-tags.ts.

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

// [slug, label, area] — spegel av COMPETENCE_TAG_SEED.
const SEED = [
  ['affarsmodell', 'Affärsmodell', 'affarscoaching'],
  ['kundvalidering', 'Kundvalidering', 'affarscoaching'],
  ['b2b-salj', 'B2B-sälj', 'affarscoaching'],
  ['b2c', 'B2C', 'affarscoaching'],
  ['prissattning', 'Prissättning', 'affarscoaching'],
  ['grundarcoaching', 'Grundarcoaching', 'affarscoaching'],
  ['irl-bedomning', 'IRL-bedömning', 'affarscoaching'],
  ['go-to-market', 'Go-to-market', 'affarsutveckling'],
  ['tillvaxtstrategi', 'Tillväxtstrategi', 'affarsutveckling'],
  ['partnerskap', 'Partnerskap', 'affarsutveckling'],
  ['styrelsearbete', 'Styrelsearbete', 'affarsutveckling'],
  ['exit-forberedelse', 'Exit-förberedelse', 'affarsutveckling'],
  ['projektledning-agil', 'Agil projektledning', 'projektledning'],
  ['eu-projekt', 'EU-projekt', 'projektledning'],
  ['vinnova-rapportering', 'Vinnova-rapportering', 'projektledning'],
  ['upphandling', 'Upphandling', 'projektledning'],
  ['eventproduktion', 'Eventproduktion', 'projektledning'],
  ['pitchtraning', 'Pitchträning', 'kommunikation'],
  ['storytelling', 'Storytelling', 'kommunikation'],
  ['linkedin', 'LinkedIn', 'kommunikation'],
  ['pr-media', 'PR & media', 'kommunikation'],
  ['nyhetsbrev', 'Nyhetsbrev', 'kommunikation'],
  ['content-produktion', 'Content-produktion', 'kommunikation'],
  ['rekrytering', 'Rekrytering', 'hr_personal'],
  ['ledarskap', 'Ledarskap', 'hr_personal'],
  ['teamutveckling', 'Teamutveckling', 'hr_personal'],
  ['arbetsmiljo', 'Arbetsmiljö', 'hr_personal'],
  ['aktieagaravtal', 'Aktieägaravtal', 'juridik'],
  ['ip-strategi', 'IP-strategi', 'juridik'],
  ['gdpr', 'GDPR', 'juridik'],
  ['statsstod', 'Statsstöd', 'juridik'],
  ['de-minimis', 'De minimis', 'juridik'],
  ['bolagsbildning', 'Bolagsbildning', 'juridik'],
  ['vinnova-ansokan', 'Vinnova-ansökan', 'finansiering_kapital'],
  ['eic', 'EIC', 'finansiering_kapital'],
  ['almi', 'Almi', 'finansiering_kapital'],
  ['angelinvesterare', 'Ängelinvesterare', 'finansiering_kapital'],
  ['vc', 'Riskkapital (VC)', 'finansiering_kapital'],
  ['term-sheet', 'Term sheet', 'finansiering_kapital'],
  ['budget-prognos', 'Budget & prognos', 'finansiering_kapital'],
  ['vardering', 'Värdering', 'finansiering_kapital'],
  ['stodcheckar', 'Stödcheckar', 'finansiering_kapital'],
  ['ai-strategi', 'AI-strategi', 'ai_teknik'],
  ['saas', 'SaaS', 'ai_teknik'],
  ['produktutveckling', 'Produktutveckling', 'ai_teknik'],
  ['mvp', 'MVP', 'ai_teknik'],
  ['data-analys', 'Data & analys', 'ai_teknik'],
  ['cybersakerhet', 'Cybersäkerhet', 'ai_teknik'],
  ['esg-rapportering', 'ESG-rapportering', 'hallbarhet'],
  ['klimatberakning', 'Klimatberäkning', 'hallbarhet'],
  ['cirkular-ekonomi', 'Cirkulär ekonomi', 'hallbarhet'],
  ['impact-matning', 'Impact-mätning', 'hallbarhet'],
  ['export', 'Export', 'internationalisering'],
  ['eoi', 'EoI', 'internationalisering'],
  ['norden', 'Norden', 'internationalisering'],
  ['usa', 'USA', 'internationalisering'],
  ['tyskland-dach', 'Tyskland/DACH', 'internationalisering'],
  ['boost-chamber', 'Boost Chamber', 'boost_chamber'],
  ['spark', 'SPARK', 'boost_chamber'],
  ['deeptech', 'Deeptech', 'boost_chamber'],
  ['ux-research', 'UX-research', 'design'],
  ['varumarke', 'Varumärke', 'design'],
  ['prototyper', 'Prototyper', 'design'],
  ['medtech', 'Medtech', 'branschspecifik'],
  ['life-science', 'Life science', 'branschspecifik'],
  ['industri', 'Industri', 'branschspecifik'],
  ['energi', 'Energi', 'branschspecifik'],
  ['foodtech', 'Foodtech', 'branschspecifik'],
  ['offentlig-sektor', 'Offentlig sektor', 'branschspecifik'],
  ['besoksnaring', 'Besöksnäring', 'branschspecifik'],
  ['skog-tra', 'Skog & trä', 'branschspecifik'],
  ['gaming', 'Gaming', 'branschspecifik']
];

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const users = app.findCollectionByNameOrId('users');

    // 1. users: hashtags + utvecklingsintressen ------------------------------
    if (!users.fields.getByName('competence_tags')) {
      users.fields.add(
        new Field({ name: 'competence_tags', type: 'json', required: false, maxSize: 8000 })
      );
    }
    if (!users.fields.getByName('development_interests')) {
      users.fields.add(
        new Field({ name: 'development_interests', type: 'json', required: false, maxSize: 2000 })
      );
    }
    app.save(users);

    // 2. competence_tags: tenant-gemensam vokabulär --------------------------
    let collection;
    try {
      collection = app.findCollectionByNameOrId('competence_tags');
    } catch (e) {
      collection = null;
    }
    if (!collection) {
      collection = new Collection({
        id: 'competence_tags_collection',
        name: 'competence_tags',
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
          // Normaliserad slug (se normalizeCompetenceTagSlug) — det som
          // lagras på personernas competence_tags.
          { name: 'slug', type: 'text', required: true, min: 1, max: 40 },
          { name: 'label', type: 'text', required: true, min: 1, max: 60 },
          // Kompetensområde (CompetenceId) — text, valideras i koden.
          { name: 'area', type: 'text', required: true, min: 1, max: 40 },
          {
            name: 'status',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['suggested', 'approved']
          },
          {
            name: 'created_by',
            type: 'relation',
            required: false,
            collectionId: users.id,
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 1
          }
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_competence_tags_tenant_slug ON competence_tags (tenant, slug)',
          'CREATE INDEX idx_competence_tags_tenant_area ON competence_tags (tenant, area)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        // Body-fält (inte poster) får prövas i createRule (§ 46.8-mönstret):
        // bara `suggested`, i eget namn, i egen tenant. Rollen (staff) prövas i
        // profil-actionen — en bolagsmedlem kan inte nå registreringen.
        createRule:
          `${ANY_AUTH} && ${ANY_TENANT} && @request.body.created_by = @request.auth.id && ` +
          `@request.body.status = "suggested" && @request.body.tenant = @request.auth.tenant`,
        updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
      });
      app.save(collection);
    }

    // 3. Seed per tenant (best-effort, idempotent på (tenant, slug)) ---------
    // Utan seed faller appen tillbaka på den inbyggda listan i
    // @platform/shared (fail-soft), men då kan taggarna inte godkännas/döpas
    // om — så vi materialiserar dem här (§ 30.3-precedensen).
    try {
      const saved = app.findCollectionByNameOrId('competence_tags');
      const tenants = app.findRecordsByFilter('tenants', '', '-created', 0, 0);
      for (const tenant of tenants) {
        for (const [slug, label, area] of SEED) {
          const existing = app.findRecordsByFilter(
            'competence_tags',
            `tenant = "${tenant.id}" && slug = "${slug}"`,
            '',
            1,
            0
          );
          if (existing.length > 0) continue;
          const rec = new Record(saved);
          rec.set('tenant', tenant.id);
          rec.set('slug', slug);
          rec.set('label', label);
          rec.set('area', area);
          rec.set('status', 'approved');
          app.save(rec);
        }
      }
    } catch (e) {
      console.log('[1700000178] seed av competence_tags hoppades över: ' + e);
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('competence_tags'));
    } catch (e) {
      /* ignore */
    }
    const users = app.findCollectionByNameOrId('users');
    ['competence_tags', 'development_interests'].forEach((name) => {
      const f = users.fields.getByName(name);
      if (f) users.fields.remove(f);
    });
    return app.save(users);
  }
);
