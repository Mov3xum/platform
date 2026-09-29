/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46.6 — Regelgenererade uppföljningar för stödcheckar ÄR vanliga
// `tasks` (samma mönster som upphandlingarna, migration 1700000152):
// `link_kind` utökas som UNION med 'support_check' och relationen
// `support_check_application` pekar ut ärendet. `rule_key` finns redan
// (1700000152) och bär prefixet `check:` så nycklarna aldrig kolliderar med
// upphandlingarnas (§ 40.2). `startup` sätts INTE av synken (RLS § 21) —
// bolagets tavla hittar korten via `support_check_application.startup`.
// cascadeDelete: raderas ansökan försvinner dess genererade kort.

const LINK_KINDS = ['support_check'];

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const applications = app.findCollectionByNameOrId('support_check_applications');

    const linkKind = tasks.fields.getByName('link_kind');
    if (linkKind) {
      const current = Array.isArray(linkKind.values) ? Array.from(linkKind.values) : [];
      const missing = LINK_KINDS.filter((v) => !current.includes(v));
      if (missing.length > 0) linkKind.values = [...current, ...missing];
    }

    if (!tasks.fields.getByName('support_check_application')) {
      tasks.fields.add(
        new Field({
          name: 'support_check_application',
          type: 'relation',
          required: false,
          collectionId: applications.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }
    if (!tasks.fields.getByName('rule_key')) {
      tasks.fields.add(new Field({ name: 'rule_key', type: 'text', required: false, max: 120 }));
    }
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const linkKind = tasks.fields.getByName('link_kind');
    if (linkKind && Array.isArray(linkKind.values)) {
      linkKind.values = linkKind.values.filter((v) => !LINK_KINDS.includes(v));
    }
    const f = tasks.fields.getByName('support_check_application');
    if (f) tasks.fields.remove(f);
    app.save(tasks);
  }
);
