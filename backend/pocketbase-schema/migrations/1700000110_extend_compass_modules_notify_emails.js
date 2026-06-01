/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — notifiering av nya inflöden via e-post (Resend).
// Lägger till `notify_emails` på compass_modules: en frivillig lista över
// mottagaradresser (komma-/radseparerade) dit ett nytt inflöde (lead) mejlas
// så snart det kommer in via en publik intag-modul. Tom = faller tillbaka på
// env `MOVEXUM_INFLOW_EMAIL` (Coolify). Fältet redigeras per modul i admin-UI:t
// så Movexum dynamiskt kan styra vilken/vilka adresser inflödet går till.
//
// Mejlet är en intern staff-notis (rättslig grund: berättigat intresse —
// inkubatordrift). compass-kollektionerna förblir denylistade i AI-kontexten
// (CLAUDE.md § 9.3) — detta är ingen ny AI-väg.

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    modules.fields.add(new Field({ name: 'notify_emails', type: 'text', required: false, max: 1000 }));
    app.save(modules);
  },
  (app) => {
    // Down: ta bort fältet (collection + data bevaras).
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const fld = modules.fields.getByName('notify_emails');
      if (fld) modules.fields.remove(fld.id);
      app.save(modules);
    } catch (e) {
      // ignore
    }
  }
);
