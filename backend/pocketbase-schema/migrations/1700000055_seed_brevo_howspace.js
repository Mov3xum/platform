/// <reference path="../pb_data/types.d.ts" />

// Seeds Brevo (FR — EU-replacement for Mailchimp; CLAUDE.md § 10.2)
// and Howspace (FI — collaborative learning) as the first two
// providers with a real sync handler. Upserts by slug.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('integration_providers');

    const providers = [
      {
        slug: 'brevo',
        name: 'Brevo',
        category: 'marketing',
        placeholder: 'BR',
        tagline: 'E-postmarknadsföring & nyhetsbrev (EU)',
        description:
          'Anslut Brevo (tidigare Sendinblue, franskt och EU-baserat) för att synka audiences och kampanjresultat till plattformen. Endast aggregerade metrics lagras — inga e-postadresser lämnar Brevo.',
        features: [
          'Audiences med antal kontakter',
          'Skickade kampanjer med öppnings- och klickfrekvens',
          'Inga personuppgifter lagras hos oss',
          'EU-suveränt — data stannar i Frankrike'
        ],
        availability: 'available',
        sort_order: 10
      },
      {
        slug: 'howspace',
        name: 'Howspace',
        category: 'learning',
        placeholder: 'HS',
        tagline: 'Collaborative learning & program (EU)',
        description:
          'Howspace (finskt) används för inkubatorprogram, workshops och kohort-lärande. Synka workspaces, deltagarstatistik och anonymiserade post-summaries till plattformen.',
        features: [
          'Workspaces & program kopplade per tenant',
          'Aggregerad deltagarstatistik (inga namn lagras)',
          'Anonymiserade post-summaries i aktivitetsfeeden',
          'EU-suveränt — data stannar i Finland'
        ],
        availability: 'available',
        sort_order: 10
      }
    ];

    for (const p of providers) {
      let existing = null;
      try {
        existing = app.findFirstRecordByFilter(
          'integration_providers',
          `slug = "${p.slug}"`
        );
      } catch (e) {
        // not found — fall through to create
      }

      if (existing) {
        existing.set('name', p.name);
        existing.set('category', p.category);
        existing.set('placeholder', p.placeholder);
        existing.set('tagline', p.tagline);
        existing.set('description', p.description);
        existing.set('features', p.features);
        existing.set('availability', p.availability);
        existing.set('sort_order', p.sort_order);
        if (existing.get('active') === undefined || existing.get('active') === null) {
          existing.set('active', true);
        }
        app.save(existing);
      } else {
        const record = new Record(col, { ...p, active: true });
        app.save(record);
      }
    }
  },
  (app) => {
    for (const slug of ['brevo', 'howspace']) {
      try {
        const r = app.findFirstRecordByFilter(
          'integration_providers',
          `slug = "${slug}"`
        );
        if (r) app.delete(r);
      } catch (e) {
        /* ignore */
      }
    }
  }
);
