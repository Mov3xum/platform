#!/usr/bin/env node
/**
 * Direkt-seed av Startupkompassen-modulen «Har du en idé med innovationspotential?»
 * (publik slug `innovationspotential`) MOT EN KÖRANDE PocketBase-instans via REST.
 *
 * Varför detta finns vid sidan av migrationen
 * (1700000123_populate_innovationspotential_profilquiz.js):
 *   Migrationer bakas in i PB-imagen och körs bara när SJÄLVA PocketBase-
 *   containern byggs om och startar (--migrationsDir=/pb/pb_migrations). Om man
 *   bygger om web-appen men inte PB-resursen i Coolify, eller om _migrations-
 *   historiken är osynkad, syns aldrig den nya migrationen. Det här skriptet kör
 *   samma seed via superuser-API:t — ingen image-rebuild krävs, effekt direkt.
 *   Samma mönster som setup-via-api.mjs.
 *
 * Idempotent: hittar modulen (public_slug i första hand, internt slug i andra),
 * sätter quiz-flaggor + result_buckets, och ERSÄTTER frågorna deterministiskt.
 * Rör INTE namn/beskrivning/välkomsttext (de redigeras i UI:t).
 *
 * Usage:
 *   PB_URL='https://<din-pb-domän>' \
 *   PB_SU_EMAIL='hampus@movexum.se' \
 *   PB_SU_PASSWORD='<superuser-lösenord>' \
 *   node backend/pocketbase-schema/scripts/seed-innovationspotential-quiz.mjs
 *
 * OBS: PB_URL ska peka på PocketBase-instansen (inte Next.js-appen).
 */

import PocketBase from 'pocketbase';

const PB_URL_RAW = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;

if (!PB_URL_RAW || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Saknar env. Krävs: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

const PB_URL = /^https?:\/\//i.test(PB_URL_RAW) ? PB_URL_RAW : `https://${PB_URL_RAW}`;

const PUBLIC_SLUG = 'innovationspotential';
const INTERNAL_SLUG = 'innovationspotential';
const FALLBACK_SLUGS = ['entreprenorsprofil'];

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

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

async function main() {
  console.log('• PB_URL:', PB_URL);
  await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
  console.log('✓ Superuser-auth OK');

  // Sanity: finns compass_modules-kollektionen alls?
  try {
    await pb.collections.getOne('compass_modules');
  } catch (e) {
    console.error(
      '✗ Kollektionen compass_modules SAKNAS i instansen. Då har compass-migrationerna ' +
        'aldrig körts (migration-only). Kör diagnose-migrations.mjs / reconcile innan seed.'
    );
    process.exit(2);
  }

  // Hitta modulen: public_slug/slug för primärslug, med fallback för omdöpt modul.
  const slugCandidates = [...new Set([PUBLIC_SLUG, INTERNAL_SLUG, ...FALLBACK_SLUGS])];
  const byId = new Map();
  for (const slug of slugCandidates) {
    const byPublicSlug = await pb
      .collection('compass_modules')
      .getFullList({ filter: pb.filter('public_slug = {:s}', { s: slug }) });
    for (const mod of byPublicSlug) byId.set(mod.id, mod);

    const byInternalSlug = await pb
      .collection('compass_modules')
      .getFullList({ filter: pb.filter('slug = {:s}', { s: slug }) });
    for (const mod of byInternalSlug) byId.set(mod.id, mod);
  }
  const modules = [...byId.values()];

  if (modules.length === 0) {
    console.error(`✗ Hittade ingen modul med public_slug/slug i [${slugCandidates.join(', ')}].`);
    const all = await pb
      .collection('compass_modules')
      .getFullList({ fields: 'id,name,slug,public_slug,flow_type' });
    console.error(`  Moduler i instansen (${all.length}):`);
    for (const m of all) {
      console.error(`   - ${m.name} | slug=${m.slug} | public_slug=${m.public_slug} | ${m.flow_type}`);
    }
    process.exit(3);
  }

  for (const mod of modules) {
    console.log(
      `\n• Modul: "${mod.name}" (id=${mod.id}, tenant=${mod.tenant}, public_slug=${mod.public_slug})`
    );

    await pb.collection('compass_modules').update(mod.id, {
      flow_type: 'quiz',
      is_active: true,
      public_url_enabled: true,
      result_buckets: RESULT_BUCKETS
    });
    console.log('  ✓ Satte flow_type=quiz, is_active, public_url_enabled, result_buckets (3 profiler)');

    // Ersätt frågorna deterministiskt.
    const old = await pb
      .collection('compass_questions')
      .getFullList({ filter: pb.filter('module = {:m}', { m: mod.id }) });
    for (const o of old) await pb.collection('compass_questions').delete(o.id);
    if (old.length) console.log(`  ✓ Raderade ${old.length} gamla frågor`);

    let order = 0;
    for (const def of QUESTIONS) {
      await pb.collection('compass_questions').create({
        module: mod.id,
        key: def.key,
        prompt: def.prompt,
        input_type: def.input_type,
        required: def.required !== false,
        sort_order: order++,
        choices: def.choices
      });
    }
    console.log(`  ✓ Skapade ${QUESTIONS.length} frågor`);

    // Verifiera.
    const after = await pb
      .collection('compass_questions')
      .getFullList({ filter: pb.filter('module = {:m}', { m: mod.id }) });
    console.log(`  ✓ Verifierat: modulen har nu ${after.length} frågor`);
  }

  console.log('\n✓ Klart. Ladda om aktuell publik modul (/m/<public_slug>) och admin-vyn.');
}

main().catch((err) => {
  console.error('✗ Fel:', err?.status || '', err?.message || err);
  if (err?.response) console.error(JSON.stringify(err.response, null, 2));
  process.exit(1);
});
