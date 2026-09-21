/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — omslagsbild på publika intag-moduler.
//
// Lägger till `hero_image` (en enskild bildfil) på `compass_modules` så att
// staff kan ladda upp en visuell omslagsbild för den publika landningssidan
// (/m/<public_slug>). Bilden ersätter den tidigare text-wordmarken i hero:n
// och ger en mer inbjudande landningssida.
//
// Filen är ICKE skyddad (default) → serveras tokenlöst via
// `${PB}/api/files/compass_modules/<id>/<filnamn>` precis som tenant-logos och
// workshop_media. Det är en avsiktligt PUBLIK marknadsföringsbild (ingen PII,
// ingen AI-inferens). compass-familjen är migration-only (CLAUDE.md § 23.4) —
// detta speglas därför inte i scripts/setup-via-api.mjs.

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    modules.fields.add(
      new Field({
        name: 'hero_image',
        type: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 15728640, // 15 MB — samma tak som workshop-bilder
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
      })
    );
    app.save(modules);
  },
  (app) => {
    // Down: ta bort fältet (collection + data bevaras).
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const fld = modules.fields.getByName('hero_image');
      if (fld) modules.fields.remove(fld.id);
      app.save(modules);
    } catch (e) {
      // ignore
    }
  }
);
