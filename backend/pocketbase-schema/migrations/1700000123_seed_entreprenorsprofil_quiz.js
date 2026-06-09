/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — fyller "Vilken entreprenörsprofil har du?"-quizet med det
// definitiva 12-frågorsinnehållet (drivkrafter, förmågor och beteenden) och tre
// resultatprofiler. Migration 1700000108 seedade en tidig variant av modulen
// `ar-du-entreprenor` och 1700000117 förfinade den till 8 frågor. Den här
// migrationen reconcile:ar samma modul (matchad på slug, per tenant) till den
// fullständiga versionen:
//   • 12 single-choice-frågor (varje val fördelar poäng via multi-hink, fältet
//     `buckets` i packages/shared/src/compass-quiz.ts).
//   • topp-hink-poängsättning → profilen med flest poäng vinner (ingen min/max).
//   • tre resultatprofiler: builder / potential / explorer, med rik
//     beskrivning + nästa-steg som länkar vidare till innovationspotential-testet.
//   • branded välkomst-/consent-text + accentfärg.
// Modulen är PUBLIK och svarbar på /m/<public_slug> (öppnas från Moduler-listan).
//
// Idempotent: kör per tenant, uppdaterar befintlig modul (matchad på slug) och
// ersätter dess frågor deterministiskt. Saknas modulen skapas den. Befintlig
// public_slug rörs inte (delade länkar bevaras); saknas den tilldelas en
// globalt ledig slug.
//
// Notera (CLAUDE.md § 23.4): compass är migration-only — speglas medvetet INTE i
// scripts/setup-via-api.mjs. Migrationen ändrar inget schema och inga
// createRules, bara dataseed, så verify-baseline.mjs-svepet påverkas inte.

const MODULE_SLUG = 'ar-du-entreprenor';

// Profilquizet pekar vidare till idé-testet. Slugen sätts av 1700000108
// (modulen `innovationspotential`); freePublicSlug ger normalt den råa slugen.
const NEXT_TEST = { label: 'Gör testet: Har din idé innovationspotential?', url: '/m/innovationspotential' };

const RESULT_BUCKETS = [
  {
    key: 'builder',
    label: 'Builder',
    title: '🚀 Builder',
    body:
      'Du har många entreprenöriella förmågor som kännetecknas av handlingskraft, ' +
      'initiativförmåga och genomförande. Du trivs med att omsätta idéer till verklighet ' +
      'och lär dig ofta genom att testa dig fram. Dessa styrkor kan du använda både som ' +
      'entreprenör och i ditt befintliga yrkesliv – särskilt i situationer där det behövs ' +
      'driv, struktur och förmåga att få saker att hända.\n\n' +
      'Dina styrkor: du tar initiativ, driver saker framåt, anpassar dig när ' +
      'förutsättningarna förändras och ser motgångar som en del av processen. I ett team ' +
      'bidrar du med att skapa momentum och ta idéer från tanke till verklighet – och ' +
      'kompletteras ofta av en 🔍 Explorer som bidrar med nya perspektiv, kreativitet och ' +
      'möjligheter att utforska.',
    tips: [
      'Du har nu fått en bild av din entreprenörsprofil. Nästa steg är att utforska själva idén.',
      'Ta nästa test och få en första indikation på hur nyskapande, skalbar och relevant din idé kan vara.'
    ],
    cta: NEXT_TEST
  },
  {
    key: 'potential',
    label: 'Potential (tidig fas)',
    title: '🌱 Potential',
    body:
      'Du har ett tydligt intresse för entreprenörskap och flera förmågor redan på plats – ' +
      'men några beteenden är värda att stärka innan du tar steget fullt ut. Det är helt ' +
      'okej; många framgångsrika grundare började precis här. Med lite mer mod att testa, ' +
      'söka feedback och slutföra det du påbörjar kan din potential växa snabbt.\n\n' +
      'Dina styrkor: du är eftertänksam, vill förstå helheten och tar gärna del av andras ' +
      'råd. I ett team bidrar du med omdöme och vilja att lära – och kompletteras ofta av en ' +
      '🚀 Builder som driver framåt och en 🔍 Explorer som hittar nya möjligheter.',
    tips: [
      'Träna på att slutföra det du påbörjar och att söka feedback regelbundet – små steg bygger självförtroende.',
      'Du har nu fått en bild av din entreprenörsprofil. Nästa steg är att utforska själva idén och få en första indikation på dess potential.'
    ],
    cta: NEXT_TEST
  },
  {
    key: 'explorer',
    label: 'Explorer',
    title: '🔍 Explorer',
    body:
      'Du har många entreprenöriella förmågor som kännetecknas av nyfikenhet, kreativitet ' +
      'och förmågan att se möjligheter där andra ser hinder. Du gillar att utforska, ' +
      'ifrågasätta och hitta nya vägar framåt. Dessa styrkor kan du använda både som ' +
      'entreprenör och i ditt befintliga yrkesliv – särskilt i roller där innovation, ' +
      'utveckling och problemlösning står i fokus.\n\n' +
      'Dina styrkor: du ser möjligheter, tänker kreativt, lär dig snabbt och utforskar nya ' +
      'perspektiv. I ett team bidrar du med nya idéer, perspektiv och framtidsmöjligheter – ' +
      'och kompletteras ofta av en 🚀 Builder som hjälper till att omsätta idéerna i praktiken.',
    tips: [
      'Du har nu fått en bild av din entreprenörsprofil. Nästa steg är att utforska själva idén.',
      'Ta nästa test och få en första indikation på hur nyskapande, skalbar och relevant din idé kan vara.'
    ],
    cta: NEXT_TEST
  }
];

// Varje fråga är single-choice. Varje val fördelar (totalt 2) poäng över
// profilerna via `buckets` — topp-hink avgör vinnaren (ingen min/max).
function q(key, prompt, opts) {
  return {
    key,
    prompt,
    input_type: 'choice',
    required: true,
    choices: opts.map((o) => ({ value: o.v, label: o.l, buckets: o.b }))
  };
}

const QUESTIONS = [
  q('driver', 'Vad driver dig mest?', [
    { v: 'losa_problem', l: 'Att lösa problem som andra upplever', b: { builder: 2 } },
    { v: 'frihet', l: 'Att skapa frihet och självständighet för mig själv', b: { builder: 1, explorer: 1 } },
    { v: 'vaxa_stort', l: 'Att bygga något som kan växa stort', b: { builder: 2 } },
    { v: 'utforska', l: 'Att utforska nya idéer och möjligheter', b: { explorer: 2 } }
  ]),
  q('reaction', 'När något inte fungerar som planerat brukar du...', [
    { v: 'testa_annat', l: 'Testa en annan lösning direkt', b: { builder: 2 } },
    { v: 'analysera', l: 'Analysera vad som gick fel först', b: { explorer: 2 } },
    { v: 'vanta', l: 'Vänta och se om situationen förändras', b: { potential: 2 } },
    { v: 'be_om_rad', l: 'Be någon annan om råd', b: { explorer: 1, potential: 1 } }
  ]),
  q('uncertainty', 'Hur känner du inför osäkerhet?', [
    { v: 'energi', l: 'Den ger energi och nya möjligheter', b: { builder: 1, explorer: 1 } },
    { v: 'hanterbar', l: 'Den är ibland obekväm men hanterbar', b: { builder: 2 } },
    { v: 'undvika', l: 'Jag vill helst undvika den', b: { potential: 2 } },
    { v: 'info_forst', l: 'Jag behöver mycket information innan jag agerar', b: { explorer: 2 } }
  ]),
  q('feedback', 'Hur brukar du hantera feedback?', [
    { v: 'soker_aktivt', l: 'Jag söker aktivt feedback för att utvecklas', b: { builder: 2 } },
    { v: 'uppskattar', l: 'Jag uppskattar feedback när jag får den', b: { builder: 1, explorer: 1 } },
    { v: 'personligen', l: 'Jag tar ofta åt mig personligen', b: { potential: 2 } },
    { v: 'undviker_bedomning', l: 'Jag undviker situationer där jag kan bli bedömd', b: { potential: 2 } }
  ]),
  q('persistence', 'Hur skulle personer omkring dig beskriva din uthållighet?', [
    { v: 'ger_sallan_upp', l: 'Jag ger sällan upp och hittar nya vägar framåt', b: { builder: 2 } },
    { v: 'haller_ut', l: 'Jag håller oftast ut tills målet är nått', b: { builder: 1, explorer: 1 } },
    { v: 'tappar_fokus', l: 'Jag tappar ibland fokus längs vägen', b: { explorer: 1, potential: 1 } },
    { v: 'gar_vidare', l: 'Jag går ofta vidare till något annat', b: { explorer: 1, potential: 1 } }
  ]),
  q('rejection', 'Om du får ett nej från en kund eller samarbetspartner...', [
    { v: 'vardefull_info', l: 'Jag ser det som värdefull information', b: { builder: 1, explorer: 1 } },
    { v: 'forsoker_igen', l: 'Jag försöker igen på ett annat sätt', b: { builder: 2 } },
    { v: 'tappar_fart', l: 'Jag blir besviken och tappar fart', b: { potential: 2 } },
    { v: 'undviker_liknande', l: 'Jag undviker liknande situationer framöver', b: { potential: 2 } }
  ]),
  q('pivot', 'Om du upptäcker att din idé inte fungerar som du tänkt...', [
    { v: 'andrar_riktning', l: 'Jag ändrar riktning och testar nytt', b: { explorer: 2 } },
    { v: 'justerar', l: 'Jag justerar delar av idén', b: { builder: 1, explorer: 1 } },
    { v: 'haller_fast', l: 'Jag håller fast vid grundplanen', b: { builder: 1, potential: 1 } },
    { v: 'osaker', l: 'Jag blir osäker på hur jag ska gå vidare', b: { potential: 2 } }
  ]),
  q('stress', 'Hur reagerar du under press?', [
    { v: 'fokuserar', l: 'Jag fokuserar och får saker gjorda', b: { builder: 2 } },
    { v: 'lugnet', l: 'Jag behåller lugnet och prioriterar', b: { builder: 1, explorer: 1 } },
    { v: 'stressad', l: 'Jag blir lätt stressad och ineffektiv', b: { potential: 2 } },
    { v: 'skjuter_upp', l: 'Jag skjuter gärna upp beslut', b: { potential: 2 } }
  ]),
  q('new_idea', 'När du får en ny idé brukar du...', [
    { v: 'testa_litet', l: 'Testa den snabbt i liten skala', b: { builder: 2 } },
    { v: 'samla_fakta', l: 'Samla fakta innan jag bestämmer mig', b: { explorer: 2 } },
    { v: 'skriva_ner', l: 'Skriva ner den till senare', b: { explorer: 1, potential: 1 } },
    { v: 'stannar_tanke', l: 'Ofta låta den stanna vid en tanke', b: { potential: 2 } }
  ]),
  q('initiative', 'Vad beskriver dig bäst?', [
    { v: 'tar_initiativ', l: 'Jag tar initiativ även när jag inte har alla svar', b: { builder: 2 } },
    { v: 'forsta_helheten', l: 'Jag vill förstå helheten innan jag agerar', b: { explorer: 2 } },
    { v: 'vantar_pa_ledning', l: 'Jag väntar gärna tills någon leder vägen', b: { potential: 2 } },
    { v: 'undviker_risk', l: 'Jag undviker situationer där jag riskerar att misslyckas', b: { potential: 2 } }
  ]),
  q('learning', 'Vilket påstående passar dig bäst?', [
    { v: 'lar_genom_gora', l: 'Jag lär mig bäst genom att göra', b: { builder: 2 } },
    { v: 'observera_analysera', l: 'Jag lär mig bäst genom att observera och analysera', b: { explorer: 2 } },
    { v: 'saker_forst', l: 'Jag vill känna mig säker innan jag testar', b: { potential: 2 } },
    { v: 'undviker_nytt', l: 'Jag undviker gärna nya situationer', b: { potential: 2 } }
  ]),
  q('today', 'Om du hade en affärsidé idag skulle du...', [
    { v: 'prata_kunder', l: 'Börja prata med potentiella kunder direkt', b: { builder: 2 } },
    { v: 'research_planera', l: 'Göra research och planera nästa steg', b: { explorer: 2 } },
    { v: 'vanta_tid', l: 'Vänta tills jag hade mer tid', b: { potential: 2 } },
    { v: 'inget', l: 'Förmodligen inte göra något alls', b: { potential: 2 } }
  ])
];

const MODULE = {
  slug: MODULE_SLUG,
  name: 'Vilken entreprenörsprofil har du?',
  description:
    'Entreprenörskap handlar inte om en särskild personlighet – det handlar om olika styrkor, ' +
    'drivkrafter och sätt att skapa värde. Ta reda på vilken entreprenörsprofil som bäst ' +
    'beskriver dig.',
  target_audience: 'founders',
  flow_type: 'quiz',
  hero_eyebrow: 'Startupkompassen',
  welcome_title: 'Vilken entreprenörsprofil har du?',
  welcome_body:
    'Entreprenörskap handlar inte om en särskild personlighet – det handlar om olika styrkor, ' +
    'drivkrafter och sätt att skapa värde. Ta reda på vilken entreprenörsprofil som bäst ' +
    'beskriver dig. Testet tar cirka 2 minuter.',
  consent_note:
    'Dina svar hanteras anonymt om du inte själv väljer att lämna kontaktuppgifter i slutet. ' +
    'Inget delas vidare. Läs mer i vår integritetspolicy.',
  success_message: 'Tack! Här är din entreprenörsprofil.',
  theme_color: '#FF5A3C',
  sort_order: 10
};

migrate(
  (app) => {
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const questionsCol = app.findCollectionByNameOrId('compass_questions');

      // Hitta en globalt ledig public_slug (alnum/bindestreck → injektionssäkert).
      function freePublicSlug(base, tenantSlug, tenantId) {
        const candidates = [base, `${base}-${tenantSlug || ''}`, `${base}-${tenantId}`];
        for (const c of candidates) {
          const clean = String(c).replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
          if (!clean) continue;
          const hit = app.findRecordsByFilter('compass_modules', `public_slug = "${clean}"`, '', 1, 0);
          if (hit.length === 0) return clean;
        }
        return `${base}-${tenantId}`;
      }

      function applyModuleFields(rec) {
        rec.set('name', MODULE.name);
        rec.set('description', MODULE.description);
        rec.set('target_audience', MODULE.target_audience);
        rec.set('flow_type', MODULE.flow_type);
        rec.set('is_active', true);
        rec.set('public_url_enabled', true);
        rec.set('sort_order', MODULE.sort_order);
        rec.set('hero_eyebrow', MODULE.hero_eyebrow);
        rec.set('welcome_title', MODULE.welcome_title);
        rec.set('welcome_body', MODULE.welcome_body);
        rec.set('consent_note', MODULE.consent_note);
        rec.set('success_message', MODULE.success_message);
        rec.set('theme_color', MODULE.theme_color);
        // Anonymt quiz — kontaktuppgifter är frivilliga.
        rec.set('require_email', false);
        rec.set('require_phone', false);
        rec.set('require_organization', false);
        rec.set('result_buckets', RESULT_BUCKETS);
      }

      function writeQuestions(moduleId) {
        // Ersätt befintliga frågor → deterministiskt innehåll och ordning.
        const old = app.findRecordsByFilter('compass_questions', `module = "${moduleId}"`, '', 0, 0);
        for (const o of old) app.delete(o);
        let order = 0;
        for (const def of QUESTIONS) {
          const qRec = new Record(questionsCol);
          qRec.set('module', moduleId);
          qRec.set('key', def.key);
          qRec.set('prompt', def.prompt);
          qRec.set('input_type', def.input_type);
          qRec.set('required', def.required !== false);
          qRec.set('sort_order', order++);
          qRec.set('choices', def.choices);
          app.save(qRec);
        }
      }

      const tenants = app.findRecordsByFilter('tenants', '', '-created', 0, 0);
      for (const t of tenants) {
        const tid = t.id;
        const tslug = t.get('slug') || '';

        const existing = app.findRecordsByFilter(
          'compass_modules',
          `tenant = "${tid}" && slug = "${MODULE_SLUG}"`,
          '',
          1,
          0
        );

        let rec;
        if (existing.length > 0) {
          rec = existing[0];
          applyModuleFields(rec);
          if (!rec.get('public_slug')) {
            rec.set('public_slug', freePublicSlug(MODULE_SLUG, tslug, tid));
          }
          app.save(rec);
        } else {
          rec = new Record(modules);
          rec.set('tenant', tid);
          rec.set('slug', MODULE_SLUG);
          rec.set('public_slug', freePublicSlug(MODULE_SLUG, tslug, tid));
          applyModuleFields(rec);
          app.save(rec);
        }

        writeQuestions(rec.id);
      }
    } catch (e) {
      // Best-effort seed — schemat ska stå även om seedningen fallerar i en
      // miljö som saknar tenants/compass-familjen.
    }
  },
  (app) => {
    // Down: ingen destruktiv återställning av innehåll (data-seed). No-op.
  }
);
