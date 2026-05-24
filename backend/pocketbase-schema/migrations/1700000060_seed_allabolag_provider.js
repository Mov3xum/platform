/// <reference path="../pb_data/types.d.ts" />

// Lägger till en provider-stub för Allabolag.se i integration_providers.
// Allabolag är publik svensk bolagsdata (org-nr, bolagsform, kommun,
// årsredovisningar) — inga personuppgifter, residency SE → riskklass
// "minimal" enligt CLAUDE.md § 11.3.
//
// Detta är BARA registret. Själva handler-implementationen
// (apps/web/src/lib/integrations/providers/allabolag/) byggs i
// uppföljande PR och kommer skriva till `startups` (registerfält) och
// `startup_financials` (årsmetrics).
//
// Migrationen utökar också `category`-enumet i integration_providers
// med 'company_registry' så att det blir en synlig grupp i UI:t.

migrate(
  (app) => {
    const providers = app.findCollectionByNameOrId('integration_providers');

    // ── Utöka category-enumet ────────────────────────────────────────
    const categoryField = providers.fields.getByName('category');
    if (categoryField && !categoryField.values.includes('company_registry')) {
      categoryField.values = [...categoryField.values, 'company_registry'];
      app.save(providers);
    }

    // ── Upsert allabolag-provider ────────────────────────────────────
    const provider = {
      slug: 'allabolag',
      name: 'Allabolag.se',
      category: 'company_registry',
      placeholder: 'AB',
      tagline: 'Bolagsregister & årsredovisningar (SE)',
      description:
        'Synkar publika bolagsdata (organisationsnummer, bolagsform, kommun, status) och årsredovisningsmetrics (omsättning, antal anställda, personalkostnad, bolagsskatt) till plattformens startups- och startup_financials-tabeller. Ersätter manuell uppdatering av Bolagslista-Excel:t.',
      features: [
        'Org-nr, bolagsform och hemkommun synkas till bolagskort',
        'Årsvis omsättning, personalkostnad och bolagsskatt',
        'Idempotent upsert per (startup, år) — inga dubbletter',
        'Publik data från SE-källa — inga personuppgifter'
      ],
      availability: 'planned',
      sort_order: 10
    };

    let existing = null;
    try {
      existing = app.findFirstRecordByFilter(
        'integration_providers',
        `slug = "${provider.slug}"`
      );
    } catch (e) {
      // not found — fall through to create
    }

    if (existing) {
      existing.set('name', provider.name);
      existing.set('category', provider.category);
      existing.set('placeholder', provider.placeholder);
      existing.set('tagline', provider.tagline);
      existing.set('description', provider.description);
      existing.set('features', provider.features);
      existing.set('availability', provider.availability);
      existing.set('sort_order', provider.sort_order);
      if (existing.get('active') === undefined || existing.get('active') === null) {
        existing.set('active', true);
      }
      app.save(existing);
    } else {
      const record = new Record(providers, { ...provider, active: true });
      app.save(record);
    }
  },
  (app) => {
    try {
      const r = app.findFirstRecordByFilter(
        'integration_providers',
        'slug = "allabolag"'
      );
      if (r) app.delete(r);
    } catch (e) {
      /* ignore */
    }

    // Ta bort category-värdet om inga andra rader använder det.
    try {
      const providers = app.findCollectionByNameOrId('integration_providers');
      const categoryField = providers.fields.getByName('category');
      if (categoryField && categoryField.values.includes('company_registry')) {
        let inUse = false;
        try {
          const rows = app.findRecordsByFilter(
            'integration_providers',
            'category = "company_registry"',
            '',
            1
          );
          inUse = rows && rows.length > 0;
        } catch (e) {
          inUse = false;
        }
        if (!inUse) {
          categoryField.values = categoryField.values.filter(
            (v) => v !== 'company_registry'
          );
          app.save(providers);
        }
      }
    } catch (e) {
      /* ignore */
    }
  }
);
