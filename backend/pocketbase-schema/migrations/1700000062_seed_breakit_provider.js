/// <reference path="../pb_data/types.d.ts" />

// Lägger till en provider-stub för Breakit.se i integration_providers.
//
// MVP-läge: Breakit-morgonagenten (1700000063) använder bara den publika
// RSS-feeden (`https://www.breakit.se/feed/artiklar`) via web.ts-
// whitelisten — det här är gratis, kräver ingen inloggning och fungerar
// idag.
//
// Den här providern är förberedd för en framtida PREMIUM-variant där
// kommersiellt avtal + credentials behövs för att hämta paywallat
// innehåll. Stubben ger:
//   - En synlig "Premium kommer"-kort i /integrationer-vyn så användarna
//     ser vart Premium-stödet hör hemma.
//   - Ett ställe att kryptera credentials (`tenant_integrations.config`,
//     AES-256-GCM via integrations/credentials.ts) när vi tar steget.
//
// Riskklass: minimal (CLAUDE.md § 11.3). Ingen AI-inferens i providern
// själv — Breakit-agentens AI-bearbetning lever i tools-collectionen och
// dokumenteras separat per agent.

migrate(
  (app) => {
    const providers = app.findCollectionByNameOrId('integration_providers');

    const provider = {
      slug: 'breakit',
      name: 'Breakit Premium',
      category: 'productivity',
      placeholder: 'BK',
      tagline: 'Svenska startup-nyheter (paywall)',
      description:
        'Förbereder credential-lagring för Breakit Premium. ' +
        'MVP-versionen av Breakit-morgonagenten använder den publika ' +
        'RSS-feeden via web.ts-whitelisten — ingen inloggning krävs. ' +
        'Denna provider aktiveras först när vi har ett kommersiellt ' +
        'avtal med Breakit för automatiserad inhämtning av betalmaterial.',
      features: [
        'Daglig sammanställning av gratis-artiklar via RSS (live idag)',
        'Premium-artiklar — kräver kommersiellt avtal med Breakit',
        'AES-256-GCM-krypterade credentials per tenant',
        'Riskklass minimal: publik svensk källa, inga personuppgifter'
      ],
      availability: 'planned',
      sort_order: 20
    };

    let existing = null;
    try {
      existing = app.findFirstRecordByFilter(
        'integration_providers',
        `slug = "${provider.slug}"`
      );
    } catch (e) {
      /* not found — create */
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
        'slug = "breakit"'
      );
      if (r) app.delete(r);
    } catch (e) {
      /* ignore */
    }
  }
);
