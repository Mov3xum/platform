/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 37 — Dashboard/anslagstavla. Lägger målgruppen 'startups'
// ("Bara bolagen") i org_posts.audience som UNION (aldrig ersätt
// values-listan — § 21.3-läxan från migration 1700000049/1700000126) och
// öppnar list/view-reglerna så en bolagsmedlem läser BÅDE audience="all" och
// audience="startups". Staff/observer läser som förut allt i tenanten (de är
// avsändare och måste kunna redigera/ta bort). MÅSTE spegla
// ORG_POST_AUDIENCES i packages/shared/src/org-posts.ts. Ingen PII, ingen
// AI-inferens. Speglas i scripts/setup-via-api.mjs.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

const MEMBER_READ = '(audience = "all" || audience = "startups")';
const READ_RULE = `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || ${MEMBER_READ})`;
const PREVIOUS_READ_RULE = `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_OR_OBSERVER} || audience = "all")`;

migrate(
  (app) => {
    const posts = app.findCollectionByNameOrId('org_posts');
    const audienceField = posts.fields.getByName('audience');
    if (audienceField) {
      const current = Array.isArray(audienceField.values) ? audienceField.values : [];
      if (!current.includes('startups')) {
        audienceField.values = [...current, 'startups'];
      }
    }
    posts.listRule = READ_RULE;
    posts.viewRule = READ_RULE;
    app.save(posts);
  },
  (app) => {
    const posts = app.findCollectionByNameOrId('org_posts');
    const audienceField = posts.fields.getByName('audience');
    if (audienceField && Array.isArray(audienceField.values)) {
      audienceField.values = audienceField.values.filter((v) => v !== 'startups');
    }
    posts.listRule = PREVIOUS_READ_RULE;
    posts.viewRule = PREVIOUS_READ_RULE;
    app.save(posts);
  }
);
