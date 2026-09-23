/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 39 — Regelgenererade uppföljningar ÄR vanliga `tasks` (samma
// mönster som uppdragskorten, migration 1700000135): `link_kind` utökas som
// union med 'procurement', relationerna `procurement`/`procurement_calloff`
// pekar ut målet och `rule_key` (`<regel>:<mål>:<n>`) gör synken idempotent —
// samma regel + mål ger aldrig två kort. `startup` sätts dessutom på
// avropsuppgifter så de syns på bolagets kanban (§ 15.7) utan ny läsväg.
// cascadeDelete: true — raderas upphandlingen/avropet försvinner dess
// genererade kort (aldrig föräldralösa uppföljningar). Ingen ny PII-väg:
// `tasks.*` är undantaget ur AI-kontexten (§ 15.3).

const LINK_KINDS = ['procurement'];

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const procurements = app.findCollectionByNameOrId('procurements');
    const calloffs = app.findCollectionByNameOrId('procurement_calloffs');

    const linkKind = tasks.fields.getByName('link_kind');
    if (linkKind) {
      const current = Array.isArray(linkKind.values) ? Array.from(linkKind.values) : [];
      const missing = LINK_KINDS.filter((v) => !current.includes(v));
      if (missing.length > 0) linkKind.values = [...current, ...missing];
    }

    if (!tasks.fields.getByName('procurement')) {
      tasks.fields.add(
        new Field({
          name: 'procurement',
          type: 'relation',
          required: false,
          collectionId: procurements.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }
    if (!tasks.fields.getByName('procurement_calloff')) {
      tasks.fields.add(
        new Field({
          name: 'procurement_calloff',
          type: 'relation',
          required: false,
          collectionId: calloffs.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }
    if (!tasks.fields.getByName('rule_key')) {
      tasks.fields.add(new Field({ name: 'rule_key', type: 'text', required: false, max: 120 }));
    }

    const indexes = Array.isArray(tasks.indexes) ? Array.from(tasks.indexes) : [];
    // UNIKT (partiellt: bara regelgenererade kort) — två parallella synkar
    // kan aldrig skapa samma uppföljning två gånger; synken tolkar 400 som
    // "finns redan".
    const idx =
      "CREATE UNIQUE INDEX idx_tasks_tenant_rule_key ON tasks (tenant, rule_key) WHERE rule_key != ''";
    if (!indexes.some((i) => String(i).includes('idx_tasks_tenant_rule_key'))) {
      tasks.indexes = [...indexes, idx];
    }

    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const linkKind = tasks.fields.getByName('link_kind');
    if (linkKind && Array.isArray(linkKind.values)) {
      linkKind.values = linkKind.values.filter((v) => !LINK_KINDS.includes(v));
    }
    for (const name of ['procurement', 'procurement_calloff', 'rule_key']) {
      const f = tasks.fields.getByName(name);
      if (f) tasks.fields.remove(f);
    }
    if (Array.isArray(tasks.indexes)) {
      tasks.indexes = tasks.indexes.filter((i) => !String(i).includes('idx_tasks_tenant_rule_key'));
    }
    app.save(tasks);
  }
);
