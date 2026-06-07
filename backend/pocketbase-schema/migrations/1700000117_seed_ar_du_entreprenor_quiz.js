/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — sätter "Är du entreprenör?"-quizet till Movexums
// definitiva självskattning (drivkrafter & förmågor). Migration 1700000108
// seedade en tidig variant av modulen `ar-du-entreprenor`; den här migrationen
// reconcile:ar modulen per tenant till det slutgiltiga innehållet:
//   • multi-hink-poängsättning (ett svar fördelar poäng över flera profiler —
//     se packages/shared/src/compass-quiz.ts, fältet `buckets`)
//   • tre resultatprofiler (builder / explorer / potential) med egna CTA:er
//   • branded välkomst-/consent-text + accentfärg
// Modulen är PUBLIK och svarbar på /m/<public_slug> (öppnas från Moduler-listan).
//
// Idempotent: kör per tenant, uppdaterar befintlig modul (matchad på slug) och
// ersätter dess frågor. Saknas modulen skapas den. Befintlig public_slug rörs
// inte (delade länkar bevaras); saknas den tilldelas en globalt ledig slug.

const MODULE_SLUG = 'ar-du-entreprenor';

const RESULT_BUCKETS = [
  {
    key: 'builder',
    label: 'Builder',
    title: 'Builder',
    body: 'Du har stark genomförandekraft och testar hellre än analyserar.',
    tips: [
      'Börja testa idéer direkt — bygg en grov prototyp inom en vecka.',
      'Sök miljöer där du kan bygga snabbt och få feedback från andra entreprenörer.'
    ],
    cta: { label: 'Utforska din idé med Movexum', url: '/m/innovation' }
  },
  {
    key: 'explorer',
    label: 'Explorer',
    title: 'Explorer',
    body: 'Du har kreativitet och driv — men behöver struktur för att ta idéer i mål.',
    tips: [
      'Jobba med tydliga delmål och deadlines.',
      'Ta hjälp av en strukturerad bollplank eller mentor.'
    ],
    cta: { label: 'Testa om din idé är redo', url: '/m/innovation' }
  },
  {
    key: 'potential',
    label: 'Potential (tidig fas)',
    title: 'Potential (tidig fas)',
    body: 'Du har intresse men behöver stärka vissa beteenden innan du hoppar in.',
    tips: [
      'Träna på att slutföra saker du påbörjat.',
      'Utsätt dig för feedback regelbundet.'
    ],
    cta: { label: 'Kontakta Nyföretagarcentrum', url: 'https://nyforetagarcentrum.se' }
  }
];

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
    { v: 'problem', l: 'Att lösa problem jag stör mig på', b: { builder: 2, explorer: 0 } },
    { v: 'frihet', l: 'Frihet och självständighet', b: { builder: 1, explorer: 1 } },
    { v: 'stort', l: 'Bygga något stort', b: { builder: 2, explorer: 0 } },
    { v: 'kreativ', l: 'Testa idéer och vara kreativ', b: { builder: 0, explorer: 2 } }
  ]),
  q('reaction', 'Hur reagerar du när något inte funkar?', [
    { v: 'ny_vag', l: 'Jag testar en ny väg direkt', b: { builder: 2, explorer: 0, potential: 0 } },
    { v: 'analyserar', l: 'Jag analyserar varför', b: { builder: 0, explorer: 2, potential: 0 } },
    { v: 'tappar', l: 'Jag tappar energi', b: { builder: 0, explorer: 0, potential: 2 } },
    { v: 'hjalp', l: 'Jag ber andra om hjälp', b: { builder: 0, explorer: 1, potential: 1 } }
  ]),
  q('uncertainty', 'Hur bekväm är du med osäkerhet?', [
    { v: 'gillar', l: 'Jag gillar det — det är spännande', b: { builder: 2, explorer: 1, potential: 0 } },
    { v: 'accepterar', l: 'Jag accepterar det', b: { builder: 1, explorer: 1, potential: 0 } },
    { v: 'stressad', l: 'Jag blir stressad', b: { builder: 0, explorer: 0, potential: 2 } },
    { v: 'undviker', l: 'Jag undviker det', b: { builder: 0, explorer: 0, potential: 2 } }
  ]),
  q('feedback', 'Hur hanterar du feedback?', [
    { v: 'soker', l: 'Jag söker aktivt feedback', b: { builder: 2, explorer: 0, potential: 0 } },
    { v: 'tar_till_mig', l: 'Jag tar till mig det mesta', b: { builder: 0, explorer: 2, potential: 0 } },
    { v: 'defensiv', l: 'Jag blir defensiv ibland', b: { builder: 0, explorer: 0, potential: 1 } },
    { v: 'undviker', l: 'Jag undviker det', b: { builder: 0, explorer: 0, potential: 2 } }
  ]),
  q('finisher', 'Hur ofta slutför du det du påbörjar?', [
    { v: 'nastan_alltid', l: 'Nästan alltid', b: { builder: 2, explorer: 0, potential: 0 } },
    { v: 'ofta', l: 'Ofta', b: { builder: 1, explorer: 1, potential: 0 } },
    { v: 'ibland', l: 'Ibland', b: { builder: 0, explorer: 1, potential: 1 } },
    { v: 'sallan', l: 'Sällan', b: { builder: 0, explorer: 0, potential: 2 } }
  ]),
  q('rejection', 'Hur reagerar du på ett "nej"?', [
    { v: 'del_av_processen', l: 'Ser det som en del av processen', b: { builder: 2, explorer: 0, potential: 0 } },
    { v: 'forsoker_igen', l: 'Försöker igen på annat sätt', b: { builder: 1, explorer: 1, potential: 0 } },
    { v: 'tappar_motivation', l: 'Tappar motivation', b: { builder: 0, explorer: 0, potential: 2 } },
    { v: 'undviker_liknande', l: 'Undviker liknande situationer', b: { builder: 0, explorer: 0, potential: 2 } }
  ]),
  q('pivot', 'Hur ser du på att ändra din idé?', [
    { v: 'pivotar', l: 'Jag pivotar gärna', b: { explorer: 2, builder: 0, potential: 0 } },
    { v: 'justerar', l: 'Jag justerar om det behövs', b: { explorer: 1, builder: 1, potential: 0 } },
    { v: 'haller_fast', l: 'Jag håller fast vid min vision', b: { explorer: 0, builder: 1, potential: 1 } },
    { v: 'osaker', l: 'Jag blir osäker', b: { explorer: 0, builder: 0, potential: 2 } }
  ]),
  q('stress', 'Hur hanterar du stress?', [
    { v: 'presterar', l: 'Jag presterar bättre', b: { builder: 2, explorer: 0, potential: 0 } },
    { v: 'haller_ihop', l: 'Jag håller ihop det', b: { builder: 1, explorer: 1, potential: 0 } },
    { v: 'ineffektiv', l: 'Jag blir ineffektiv', b: { builder: 0, explorer: 0, potential: 2 } },
    { v: 'undviker_situationen', l: 'Jag undviker situationen', b: { builder: 0, explorer: 0, potential: 2 } }
  ])
];

const MODULE = {
  slug: MODULE_SLUG,
  name: 'Är du entreprenör?',
  description: 'Självskattning av drivkrafter och förmågor för att bygga bolag.',
  target_audience: 'founders',
  flow_type: 'quiz',
  hero_eyebrow: 'Startupkompassen',
  welcome_title: 'Är du entreprenör?',
  welcome_body: 'Ta reda på om du har drivkrafter och förmågor att bli entreprenör. Tar 2 minuter.',
  consent_note:
    'Dina svar hanteras anonymt om du inte själv väljer att lämna kontaktuppgifter i slutet. ' +
    'Ingen delas vidare. Läs mer i vår integritetspolicy.',
  success_message: 'Tack! Här är din profil.',
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
