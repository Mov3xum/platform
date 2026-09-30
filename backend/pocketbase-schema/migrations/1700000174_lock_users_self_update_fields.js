/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 10.3 "Sessionsvalidering & users-fältlås" (2026-09-30).
//
// `users.updateRule` var `@request.auth.id = id` UTAN fältlås: en användare
// fick uppdatera sin egen post — inklusive `roles`, `tenant`,
// `linked_startups`, `enabled_modules` och `verified`. Auth-tokenen ligger
// visserligen i en httpOnly-cookie, men den kan läsas av kontoinnehavaren
// själv (DevTools → Application → Cookies) och användas direkt mot
// PocketBase-API:t (den publika PB-adressen finns i klientbundeln). En
// bolagsmedlem kunde alltså PATCH:a sig till `admin` i en annan tenant och
// därefter passera varje `hasRole`/tenant-kontroll i appen — inklusive
// server-actions som gör superuser-fallback (§ 21.3).
//
// Nu får kontoinnehavaren via API:t bara röra sina SJÄLVSERVICE-fält
// (display_name, avatar, title, bio, competences, lösenord med oldPassword —
// § 22.2/§ 29.2). Behörighets-/identitetsfälten låses med
// `@request.body.<fält>:isset = false` (samma mönster som 1700000163);
// admin-flödena skriver dem oförändrat via superuser (`lib/actions/users.ts`),
// e-postverifieringen likaså. `email`/`emailVisibility` låses också — e-post
// byts via PB:s request-email-change-flöde, aldrig via en rå update.
//
// Speglas i setup-via-api.mjs och asserteras i verify-baseline.mjs.

const LOCKED_SELF_UPDATE_FIELDS = [
  'roles',
  'tenant',
  'linked_startups',
  'enabled_modules',
  'disabled_modules',
  'verified',
  'email',
  'emailVisibility'
];

const SELF_UPDATE_RULE =
  '@request.auth.id = id && ' +
  LOCKED_SELF_UPDATE_FIELDS.map((f) => `@request.body.${f}:isset = false`).join(' && ');

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.updateRule = SELF_UPDATE_RULE;
    return app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.updateRule = '@request.auth.id = id';
    return app.save(users);
  }
);
