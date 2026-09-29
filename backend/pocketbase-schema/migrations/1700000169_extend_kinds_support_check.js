/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46 — enum-unioner för stödcheckar:
//   - activities.kind += 'support_check' (beslut/utbetalning loggas på
//     bolagskortet: "Beviljad excellenscheck 50 000 kr — Marknadsundersökning").
//   - notifications.kind += 'support_check_submitted' (ny/kompletterad
//     ansökan till granskare), 'support_check_changes' (komplettering begärd
//     → bolaget), 'support_check_decision' (beslut → bolaget),
//     'support_check_comment' (svar i kommentarstråd).
// UNION — ersätt aldrig values-listan (§ 21.3-läxan från 1700000049/1700000126).
// `notify()` faller tillbaka på kind `assigned` mot ett schema utan den här
// migrationen så notisen aldrig tappas tyst (§ 45.3).

const ACTIVITY_KINDS = ['support_check'];
const NOTIFICATION_KINDS = ['support_check_submitted', 'support_check_changes', 'support_check_decision', 'support_check_comment'];

function union(col, fieldName, values) {
  const field = col.fields.getByName(fieldName);
  if (!field) return false;
  const current = Array.isArray(field.values) ? Array.from(field.values) : [];
  const missing = values.filter((v) => !current.includes(v));
  if (missing.length === 0) return false;
  field.values = [...current, ...missing];
  return true;
}

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    if (union(acts, 'kind', ACTIVITY_KINDS)) app.save(acts);
    const notifs = app.findCollectionByNameOrId('notifications');
    if (union(notifs, 'kind', NOTIFICATION_KINDS)) app.save(notifs);
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const k = acts.fields.getByName('kind');
    if (k && Array.isArray(k.values)) {
      k.values = k.values.filter((v) => !ACTIVITY_KINDS.includes(v));
      app.save(acts);
    }
    const notifs = app.findCollectionByNameOrId('notifications');
    const n = notifs.fields.getByName('kind');
    if (n && Array.isArray(n.values)) {
      n.values = n.values.filter((v) => !NOTIFICATION_KINDS.includes(v));
      app.save(notifs);
    }
  }
);
