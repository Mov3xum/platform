/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — fyller modulen «Har du en idé med innovationspotential?»
// (publik slug `innovationspotential`) med dess frågor och resultatlogik.
// Modulen finns redan (skapad/redigerad i admin-UI:t) men saknar frågor → den
// publika sidan har inget att visa. Den här migrationen seedar:
//   • 12 single-choice-frågor (verbatim text + valalternativ).
//   • tre resultatprofiler (builder / potential / explorer) som result_buckets.
//   • topp-hink-poängsättning: varje val fördelar poäng över profilerna via
//     fältet `buckets` (se packages/shared/src/compass-quiz.ts) → profilen med
//     flest poäng vinner. Ingen min/max → inte intervall-läge.
//
// MATCHNING: modulen träffas i FÖRSTA hand på `public_slug = "innovationspotential"`
// (globalt unikt index → exakt den modul användaren ser i UI:t), i andra hand på
// internt `slug = "innovationspotential"` per tenant (den seedade modulen från
// 1700000108). Vi RÖR INTE namn/beskrivning/välkomsttext — de är satta i UI:t och
// ska bevaras. Vi sätter bara result_buckets + säkrar quiz/aktiv-flaggorna och
// ersätter frågorna deterministiskt.
//
// Idempotent. Body-värdena är konstanta literaler (ingen interpolation i filter).
// CLAUDE.md § 23.4: compass är migration-only — speglas inte i setup-via-api.mjs;
// inga schema- eller createRule-ändringar här, så verify-baseline-svepet påverkas inte.

const PUBLIC_SLUG = 'innovationspotential';
const INTERNAL_SLUG = 'innovationspotential';

// Profilquizet leder vidare till Movexums idé-/rådgivningsflöde (chatten),
// inte till sig självt.
const NEXT_CTA = { label: 'Berätta om din idé för Movexum', url: '/m/grundare' };

// Ordningen styr oavgjort (topp-hink: först i listan vinner vid lika poäng).
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
      'Få vägledning av Movexum om hur nyskapande, skalbar och relevant din idé kan vara.'
    ],
    cta: NEXT_CTA
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
      'Få vägledning av Movexum om hur nyskapande, skalbar och relevant din idé kan vara.'
    ],
    cta: NEXT_CTA
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
      'Nästa steg är att utforska din idé tillsammans med Movexum.'
    ],
    cta: NEXT_CTA
  }
];

// Single-choice. Varje val fördelar (totalt 2) poäng över profilerna via `buckets`.
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
  q('q1_driver', 'Vad driver dig mest?', [
    { v: 'losa_problem', l: 'Att lösa problem som andra upplever', b: { builder: 2 } },
    { v: 'frihet', l: 'Att skapa frihet och självständighet för mig själv', b: { builder: 1, explorer: 1 } },
    { v: 'vaxa_stort', l: 'Att bygga något som kan växa stort', b: { builder: 2 } },
    { v: 'utforska', l: 'Att utforska nya idéer och möjligheter', b: { explorer: 2 } }
  ]),
  q('q2_reaction', 'När något inte fungerar som planerat brukar du...', [
    { v: 'testa_annat', l: 'Testa en annan lösning direkt', b: { builder: 2 } },
    { v: 'analysera', l: 'Analysera vad som gick fel först', b: { explorer: 2 } },
    { v: 'vanta', l: 'Vänta och se om situationen förändras', b: { potential: 2 } },
    { v: 'be_om_rad', l: 'Be någon annan om råd', b: { explorer: 1, potential: 1 } }
  ]),
  q('q3_uncertainty', 'Hur känner du inför osäkerhet?', [
    { v: 'energi', l: 'Den ger energi och nya möjligheter', b: { builder: 1, explorer: 1 } },
    { v: 'hanterbar', l: 'Den är ibland obekväm men hanterbar', b: { builder: 2 } },
    { v: 'undvika', l: 'Jag vill helst undvika den', b: { potential: 2 } },
    { v: 'info_forst', l: 'Jag behöver mycket information innan jag agerar', b: { explorer: 2 } }
  ]),
  q('q4_feedback', 'Hur brukar du hantera feedback?', [
    { v: 'soker_aktivt', l: 'Jag söker aktivt feedback för att utvecklas', b: { builder: 2 } },
    { v: 'uppskattar', l: 'Jag uppskattar feedback när jag får den', b: { builder: 1, explorer: 1 } },
    { v: 'personligen', l: 'Jag tar ofta åt mig personligen', b: { potential: 2 } },
    { v: 'undviker_bedomning', l: 'Jag undviker situationer där jag kan bli bedömd', b: { potential: 2 } }
  ]),
  q('q5_persistence', 'Hur skulle personer omkring dig beskriva din uthållighet?', [
    { v: 'ger_sallan_upp', l: 'Jag ger sällan upp och hittar nya vägar framåt', b: { builder: 2 } },
    { v: 'haller_ut', l: 'Jag håller oftast ut tills målet är nått', b: { builder: 1, explorer: 1 } },
    { v: 'tappar_fokus', l: 'Jag tappar ibland fokus längs vägen', b: { explorer: 1, potential: 1 } },
    { v: 'gar_vidare', l: 'Jag går ofta vidare till något annat', b: { explorer: 1, potential: 1 } }
  ]),
  q('q6_rejection', 'Om du får ett nej från en kund eller samarbetspartner...', [
    { v: 'vardefull_info', l: 'Jag ser det som värdefull information', b: { builder: 1, explorer: 1 } },
    { v: 'forsoker_igen', l: 'Jag försöker igen på ett annat sätt', b: { builder: 2 } },
    { v: 'tappar_fart', l: 'Jag blir besviken och tappar fart', b: { potential: 2 } },
    { v: 'undviker_liknande', l: 'Jag undviker liknande situationer framöver', b: { potential: 2 } }
  ]),
  q('q7_pivot', 'Om du upptäcker att din idé inte fungerar som du tänkt...', [
    { v: 'andrar_riktning', l: 'Jag ändrar riktning och testar nytt', b: { explorer: 2 } },
    { v: 'justerar', l: 'Jag justerar delar av idén', b: { builder: 1, explorer: 1 } },
    { v: 'haller_fast', l: 'Jag håller fast vid grundplanen', b: { builder: 1, potential: 1 } },
    { v: 'osaker', l: 'Jag blir osäker på hur jag ska gå vidare', b: { potential: 2 } }
  ]),
  q('q8_stress', 'Hur reagerar du under press?', [
    { v: 'fokuserar', l: 'Jag fokuserar och får saker gjorda', b: { builder: 2 } },
    { v: 'lugnet', l: 'Jag behåller lugnet och prioriterar', b: { builder: 1, explorer: 1 } },
    { v: 'stressad', l: 'Jag blir lätt stressad och ineffektiv', b: { potential: 2 } },
    { v: 'skjuter_upp', l: 'Jag skjuter gärna upp beslut', b: { potential: 2 } }
  ]),
  q('q9_new_idea', 'När du får en ny idé brukar du...', [
    { v: 'testa_litet', l: 'Testa den snabbt i liten skala', b: { builder: 2 } },
    { v: 'samla_fakta', l: 'Samla fakta innan jag bestämmer mig', b: { explorer: 2 } },
    { v: 'skriva_ner', l: 'Skriva ner den till senare', b: { explorer: 1, potential: 1 } },
    { v: 'stannar_tanke', l: 'Ofta låta den stanna vid en tanke', b: { potential: 2 } }
  ]),
  q('q10_initiative', 'Vad beskriver dig bäst?', [
    { v: 'tar_initiativ', l: 'Jag tar initiativ även när jag inte har alla svar', b: { builder: 2 } },
    { v: 'forsta_helheten', l: 'Jag vill förstå helheten innan jag agerar', b: { explorer: 2 } },
    { v: 'vantar_pa_ledning', l: 'Jag väntar gärna tills någon leder vägen', b: { potential: 2 } },
    { v: 'undviker_risk', l: 'Jag undviker situationer där jag riskerar att misslyckas', b: { potential: 2 } }
  ]),
  q('q11_learning', 'Vilket påstående passar dig bäst?', [
    { v: 'lar_genom_gora', l: 'Jag lär mig bäst genom att göra', b: { builder: 2 } },
    { v: 'observera_analysera', l: 'Jag lär mig bäst genom att observera och analysera', b: { explorer: 2 } },
    { v: 'saker_forst', l: 'Jag vill känna mig säker innan jag testar', b: { potential: 2 } },
    { v: 'undviker_nytt', l: 'Jag undviker gärna nya situationer', b: { potential: 2 } }
  ]),
  q('q12_today', 'Om du hade en affärsidé idag skulle du...', [
    { v: 'prata_kunder', l: 'Börja prata med potentiella kunder direkt', b: { builder: 2 } },
    { v: 'research_planera', l: 'Göra research och planera nästa steg', b: { explorer: 2 } },
    { v: 'vanta_tid', l: 'Vänta tills jag hade mer tid', b: { potential: 2 } },
    { v: 'inget', l: 'Förmodligen inte göra något alls', b: { potential: 2 } }
  ])
];

migrate(
  (app) => {
    try {
      const questionsCol = app.findCollectionByNameOrId('compass_questions');

      function ensureQuizFields(rec) {
        // Rör INTE namn/beskrivning/välkomst — bevara användarens UI-text.
        rec.set('flow_type', 'quiz');
        rec.set('is_active', true);
        rec.set('public_url_enabled', true);
        rec.set('result_buckets', RESULT_BUCKETS);
      }

      function writeQuestions(moduleId) {
        // Ersätt ev. befintliga frågor → deterministiskt innehåll och ordning.
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

      // 1) Exakt modul som användaren ser i UI:t — globalt unik public_slug.
      const byPublic = app.findRecordsByFilter(
        'compass_modules',
        `public_slug = "${PUBLIC_SLUG}"`,
        '',
        0,
        0
      );
      const handled = {};
      for (const rec of byPublic) {
        ensureQuizFields(rec);
        app.save(rec);
        writeQuestions(rec.id);
        handled[rec.id] = true;
      }

      // 2) Per tenant: den seedade modulen (internt slug) om public_slug-träff
      //    saknas i den tenanten (täcker fler tenants + fräscha instanser).
      const tenants = app.findRecordsByFilter('tenants', '', '-created', 0, 0);
      for (const t of tenants) {
        const tid = t.id;
        const inTenant = app.findRecordsByFilter(
          'compass_modules',
          `tenant = "${tid}" && slug = "${INTERNAL_SLUG}"`,
          '',
          0,
          0
        );
        for (const rec of inTenant) {
          if (handled[rec.id]) continue;
          ensureQuizFields(rec);
          app.save(rec);
          writeQuestions(rec.id);
          handled[rec.id] = true;
        }
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
