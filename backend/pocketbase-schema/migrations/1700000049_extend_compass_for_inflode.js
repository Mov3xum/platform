/// <reference path="../pb_data/types.d.ts" />

// Inflöde-rebrandet (tidigare "Startupkompassen") — bygger ut datamodellen
// så vi kan:
//   • Spåra var inflödet kommer ifrån (UTM/attribution + referrer)
//   • Köra AI-omvärldsanalys per lead och spara strukturerat resultat
//   • Konvertera ett lead till ett startup-record med all idé-info bevarad
//   • Publicera moduler på en publik URL (utan inloggning) och mäta visningar
//
// Vi behåller collection-namnen (compass_*) eftersom befintlig data är
// migrerad. Konceptuellt heter den "Inflöde" i UI/RBAC från och med nu.

migrate(
  (app) => {
    // 1. compass_leads — utöka med attribution + AI-analys + konvertering
    const leads = app.findCollectionByNameOrId('compass_leads');
    const startupsCol = app.findCollectionByNameOrId('startups');

    leads.fields.add(new Field({ name: 'utm_source', type: 'text', required: false, max: 100 }));
    leads.fields.add(new Field({ name: 'utm_medium', type: 'text', required: false, max: 100 }));
    leads.fields.add(new Field({ name: 'utm_campaign', type: 'text', required: false, max: 100 }));
    leads.fields.add(new Field({ name: 'utm_term', type: 'text', required: false, max: 100 }));
    leads.fields.add(new Field({ name: 'utm_content', type: 'text', required: false, max: 200 }));
    leads.fields.add(new Field({ name: 'referrer_url', type: 'text', required: false, max: 500 }));
    leads.fields.add(new Field({ name: 'landing_module', type: 'text', required: false, max: 100 }));
    leads.fields.add(new Field({ name: 'market_scan', type: 'json', required: false, maxSize: 200000 }));
    leads.fields.add(new Field({ name: 'ai_review', type: 'json', required: false, maxSize: 200000 }));
    leads.fields.add(new Field({
      name: 'converted_startup',
      type: 'relation',
      required: false,
      collectionId: startupsCol.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: 1
    }));
    leads.fields.add(new Field({ name: 'converted_at', type: 'date', required: false }));

    app.save(leads);

    // 2. compass_modules — publicering på publik URL, success-text, redirect
    const modules = app.findCollectionByNameOrId('compass_modules');

    modules.fields.add(new Field({ name: 'public_url_enabled', type: 'bool', required: false }));
    modules.fields.add(new Field({ name: 'target_audience', type: 'text', required: false, max: 500 }));
    modules.fields.add(new Field({ name: 'success_message', type: 'text', required: false, max: 2000 }));
    modules.fields.add(new Field({ name: 'redirect_url', type: 'text', required: false, max: 500 }));
    modules.fields.add(new Field({ name: 'theme_color', type: 'text', required: false, max: 20 }));
    modules.fields.add(new Field({ name: 'intro_message', type: 'text', required: false, max: 2000 }));

    app.save(modules);

    // 3. Seeda en demo-modul per tenant om ingen finns ännu — så att
    //    rebrandet känns "live" på en gång.
    try {
      const tenants = app.findRecordsByFilter('tenants', '', '-created', 0, 0);
      for (const t of tenants) {
        const tid = t.id;
        const existing = app.findRecordsByFilter(
          'compass_modules',
          `tenant = "${tid}"`,
          '-created',
          1,
          0
        );
        if (existing.length > 0) continue;

        // Chat-modul
        const chatMod = new Record(modules);
        chatMod.set('tenant', tid);
        chatMod.set('slug', 'idechat');
        chatMod.set('name', 'AI-idechatt');
        chatMod.set('description', 'En kort, vänlig dialog där du beskriver din idé och får direkt feedback från Movexums AI-rådgivare.');
        chatMod.set('flow_type', 'chat');
        chatMod.set('is_active', true);
        chatMod.set('public_url_enabled', true);
        chatMod.set('target_audience', 'Idébärare med en idé i tidigt stadium.');
        chatMod.set('intro_message', 'Berätta om idén — vad försöker du lösa, för vem?');
        chatMod.set('success_message', 'Tack! En människa från Movexum hör av sig inom 3 arbetsdagar.');
        chatMod.set('model', 'mistral-large-latest');
        chatMod.set('sort_order', 0);
        chatMod.set('consent_note', 'Du samtycker till att Movexum kontaktar dig och lagrar dina uppgifter inom EU. Konfidentiella anteckningar exkluderas alltid från AI-anrop.');
        app.save(chatMod);

        // Formulär-modul (wizard)
        const wizMod = new Record(modules);
        wizMod.set('tenant', tid);
        wizMod.set('slug', 'snabbintag');
        wizMod.set('name', 'Snabbintag — 4 frågor');
        wizMod.set('description', 'En komprimerad ansökan i 4 frågor. Tar 2 minuter.');
        wizMod.set('flow_type', 'wizard');
        wizMod.set('is_active', true);
        wizMod.set('public_url_enabled', true);
        wizMod.set('target_audience', 'Personer som vill ansöka direkt till inkubatorn.');
        wizMod.set('success_message', 'Tack — vi har dina svar. En människa från Movexum tittar på din ansökan och hör av sig inom 3 arbetsdagar.');
        wizMod.set('sort_order', 1);
        app.save(wizMod);

        // Seeda frågor till wizard-modulen
        const questions = app.findCollectionByNameOrId('compass_questions');
        const wizQuestions = [
          { key: 'name', prompt: 'Vad heter du?', input_type: 'short_text', required: true, sort_order: 0 },
          { key: 'email', prompt: 'Vilken e-postadress kan vi nå dig på?', input_type: 'email', required: true, sort_order: 1 },
          { key: 'idea_summary', prompt: 'Beskriv din idé kort.', help_text: 'Vad löser den? Vem är målgruppen?', input_type: 'long_text', required: true, sort_order: 2 },
          { key: 'category', prompt: 'Vilken kategori passar bäst?', input_type: 'choice', required: false, sort_order: 3, choices: [
            { value: 'tech', label: 'Tech / digitalt' },
            { value: 'hardware', label: 'Hårdvara / produkt' },
            { value: 'service', label: 'Tjänst / B2B' },
            { value: 'sustainable', label: 'Hållbarhet / cleantech' },
            { value: 'health', label: 'Hälsa / life science' },
            { value: 'creative', label: 'Kreativa näringar' },
            { value: 'other', label: 'Annat' }
          ] }
        ];
        for (const wq of wizQuestions) {
          const qRec = new Record(questions);
          qRec.set('module', wizMod.id);
          qRec.set('key', wq.key);
          qRec.set('prompt', wq.prompt);
          if (wq.help_text) qRec.set('help_text', wq.help_text);
          qRec.set('input_type', wq.input_type);
          qRec.set('required', wq.required);
          qRec.set('sort_order', wq.sort_order);
          if (wq.choices) qRec.set('choices', wq.choices);
          app.save(qRec);
        }
      }
    } catch (e) {
      // Best-effort seedning — om något hindrar oss (t.ex. tenants som
      // saknas i en testmiljö) ska migrationen ändå lyckas så att
      // schemat är på plats.
    }
  },
  (app) => {
    // Ta bort de nya fälten — collection-namnen tas inte bort
    try {
      const leads = app.findCollectionByNameOrId('compass_leads');
      const removeFields = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'referrer_url', 'landing_module', 'market_scan', 'ai_review',
        'converted_startup', 'converted_at'
      ];
      for (const f of removeFields) {
        const fld = leads.fields.getByName(f);
        if (fld) leads.fields.remove(fld.id);
      }
      app.save(leads);
    } catch {}

    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const removeFields = ['public_url_enabled', 'target_audience', 'success_message', 'redirect_url', 'theme_color', 'intro_message'];
      for (const f of removeFields) {
        const fld = modules.fields.getByName(f);
        if (fld) modules.fields.remove(fld.id);
      }
      app.save(modules);
    } catch {}
  }
);
