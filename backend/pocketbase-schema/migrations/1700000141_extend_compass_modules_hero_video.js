/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — omslagsvideo på publika intag-moduler.
//
// Lägger till `hero_video` (en enskild videofil) på `compass_modules` så att
// staff kan ladda upp en presentationsvideo för den publika landningssidan
// (/m/<public_slug>) — parallellt med `hero_image` (migration 1700000122).
// Finns båda används bilden som video-poster.
//
// Filen är ICKE skyddad (default) → serveras tokenlöst via
// `${PB}/api/files/compass_modules/<id>/<filnamn>` precis som hero_image och
// workshop_media. Det är avsiktligt PUBLIKT marknadsföringsmaterial (ingen PII,
// ingen AI-inferens). Uppladdning sker via route-handlern
// /api/inflode/modules/[id]/media (stora videos ryms inte i server-actions
// bodySizeLimit, CLAUDE.md § 18.2). compass-familjen är migration-only
// (CLAUDE.md § 23.4) — detta speglas därför inte i scripts/setup-via-api.mjs.

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    modules.fields.add(
      new Field({
        name: 'hero_video',
        type: 'file',
        required: false,
        maxSelect: 1,
        maxSize: 209715200, // 200 MB — samma tak som workshop-videos (MAX_WORKSHOP_VIDEO_BYTES)
        mimeTypes: [
          'video/mp4',
          'video/webm',
          'video/ogg',
          'video/quicktime',
          'video/x-msvideo',
          'video/x-matroska',
          'video/mpeg'
        ]
      })
    );
    app.save(modules);
  },
  (app) => {
    // Down: ta bort fältet (collection + data bevaras).
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const fld = modules.fields.getByName('hero_video');
      if (fld) modules.fields.remove(fld.id);
      app.save(modules);
    } catch (e) {
      // ignore
    }
  }
);
