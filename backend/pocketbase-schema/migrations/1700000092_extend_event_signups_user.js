/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 18.4 — bjuda in Movexum-resurser till ett möte.
//
// `event_signups` får ett valfritt `user`-relationsfält så att ett möte som
// skapas i samband med en workshop-/dokumenttilldelning kan lista inbjudna
// Movexum-användare (coacher/mentorer) — inte bara externa deltagare.
//
// Resurser är interna staff-användare; deras e-post lagras (legitimt intresse,
// inkubatordrift) men når aldrig AI-kontexten (event_signups whitelistas inte i
// lib/ai/context.ts).

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const signups = app.findCollectionByNameOrId('event_signups');

    if (!signups.fields.getByName('user')) {
      signups.fields.add(
        new Field({
          name: 'user',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }

    app.save(signups);

    const db = app.db();
    db.newQuery(
      'CREATE INDEX IF NOT EXISTS idx_signups_user ON event_signups (user)'
    ).execute();
  },
  (app) => {
    const signups = app.findCollectionByNameOrId('event_signups');
    const field = signups.fields.getByName('user');
    if (field) signups.fields.remove(field);
    app.save(signups);

    const db = app.db();
    db.newQuery('DROP INDEX IF EXISTS idx_signups_user').execute();
  }
);
