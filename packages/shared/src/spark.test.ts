import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPARK_ENERGY_AREAS,
  SPARK_INTERVIEW_SECTIONS,
  SPARK_SUPPORT_NEEDS,
  SPARK_TRL,
  SPARK_TRL_SOURCE,
  computeSparkIndicators,
  deriveSparkRecords,
  effectiveSparkTrl,
  normalizeSparkInterview,
  normalizeSparkOrgNr,
  sparkAcceleratorEligible,
  sparkAnonymousActorLabel,
  sparkShareableName,
  suggestSparkAcceleratorCategory,
  visibleSparkSections
} from './spark.ts';
import { KTH_TRL_LEVELS, KTH_TRL_TERMS, kthTrlCriteria, kthTrlLevel, kthTrlPromptLines } from './kth-trl.ts';
import { rankNeedsForSolution, rankSolutionsForNeed, rankTestbedsForSolution, scoreNeedSolution, sparkAreaBalance } from './spark-matching.ts';
import { buildSparkImportTemplateCsv, parseSparkImportRows, SPARK_IMPORT_COLUMNS } from './spark-import.ts';

const need = { title: 'Höga effekttoppar', description: 'Toppar vid uppstart av ugnar.', areas: ['flexibilitet_effektstyrning'], priority: 'high', horizon: 'y1_3' };
const solution = { name: 'AI-effektstyrning', description: 'Styr laster med AI.', areas: ['flexibilitet_effektstyrning'], maturity: '4', trl: '6', needs: ['pilotkund'], target_sectors: ['tillverkning'] };
const base = { name: 'Exempel AB', org_nr: '5560000000', actor_type: 'industri', sector: 'tillverkning', kommun: 'sandviken', contact_ok: 'yes', sharing: 'anonymous', contact_name: 'Kim', contact_email: 'KIM@exempel.se' };

test('kategorierna följer intervjuguiden och TRL-bladet', () => {
  assert.equal(SPARK_ENERGY_AREAS.length, 12);
  assert.equal(SPARK_SUPPORT_NEEDS.length, 16);
  assert.equal(SPARK_TRL.length, 9);
});

test('varje TRL-nivå bär KTH:s kriterier — samma text för formulär, bedömning och AI', () => {
  assert.deepEqual(KTH_TRL_LEVELS.map((l) => l.level), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const option of SPARK_TRL) {
    const level = kthTrlLevel(option.id);
    assert.ok(level, `TRL ${option.id} saknar kriterier`);
    assert.ok(level.summary.length > 10);
    assert.ok(level.criteria.length >= 2, `TRL ${option.id} ska ha minst två kriterier`);
    assert.deepEqual(option.detail, level.criteria);
    assert.deepEqual(kthTrlCriteria(Number(option.id)), level.criteria);
  }
  // Okända värden ger aldrig kriterier (formuläret visar då ingenting).
  assert.deepEqual(kthTrlCriteria('10'), []);
  assert.deepEqual(kthTrlCriteria(''), []);
  assert.equal(kthTrlLevel('2.5'), null);
  // Begreppen som skiljer nivåerna åt ska finnas med, liksom källan (licenskrav).
  const terms = KTH_TRL_TERMS.map((t) => t.term);
  for (const term of ['Laboratoriemiljö', 'Relevant miljö', 'Operationell miljö', 'Faktisk drift']) assert.ok(terms.includes(term), term);
  assert.match(SPARK_TRL_SOURCE, /KTH Innovation Readiness Level/);
  assert.match(SPARK_TRL_SOURCE, /CC BY-NC-SA/);
  // Promptunderlaget bär alla nio nivåer och begreppen.
  const prompt = kthTrlPromptLines().join('\n');
  for (let n = 1; n <= 9; n++) assert.ok(prompt.includes(`TRL ${n}:`));
  assert.ok(prompt.includes('Relevant miljö:'));
  // TRL-frågan i formuläret visar källan.
  const trlField = SPARK_INTERVIEW_SECTIONS.flatMap((s) => s.repeat?.fields ?? []).find((f) => f.key === 'trl');
  assert.equal(trlField?.source, SPARK_TRL_SOURCE);
});

test('avsnitten formas efter rollerna som anges i början', () => {
  const idsFor = (roles: Parameters<typeof visibleSparkSections>[0]) => visibleSparkSections(roles).map((s) => s.id);
  assert.deepEqual(idsFor([]), ['start', 'a', 'f']);
  assert.deepEqual(idsFor(['need_owner']), ['start', 'a', 'b', 'c', 'f']);
  assert.deepEqual(idsFor(['innovator']), ['start', 'a', 'd', 'e', 'f']);
  assert.deepEqual(idsFor(['testbed']), ['start', 'a', 'c', 'f']);
  assert.deepEqual(idsFor(['need_owner', 'innovator']), ['start', 'a', 'b', 'c', 'd', 'e', 'f']);
});

test('svar för avsnitt som inte gäller kastas, okända värden släpps', () => {
  const r = normalizeSparkInterview({
    roles: ['need_owner', 'hittepa'],
    company: { ...base, actor_type: 'påhittad', solution_matching: 'yes', support_needs: ['kapital'], okant: 'x' },
    needs: [{ ...need, areas: ['flexibilitet_effektstyrning', 'finns_inte'] }],
    solutions: [solution]
  });
  assert.ok(r.ok);
  assert.deepEqual(r.value.roles, ['need_owner']);
  assert.equal(r.value.solutions.length, 0);
  assert.equal(r.value.company.solution_matching, undefined);
  assert.equal(r.value.company.support_needs, undefined);
  assert.equal(r.value.company.actor_type, undefined);
  assert.equal(r.value.company.okant, undefined);
  assert.deepEqual(r.value.needs[0].areas, ['flexibilitet_effektstyrning']);
  assert.equal(r.value.company.org_nr, '556000-0000');
  assert.equal(r.value.company.contact_email, 'kim@exempel.se');
});

test('villkorade frågor behålls bara när villkoret är uppfyllt', () => {
  const no = normalizeSparkInterview({ roles: ['testbed'], company: { ...base, has_testbed: 'no', testbed_description: 'Ugnshall' } });
  assert.equal(no.value.company.testbed_description, undefined);
  const yes = normalizeSparkInterview({ roles: ['testbed'], company: { ...base, has_testbed: 'yes', testbed_description: 'Ugnshall' } });
  assert.equal(yes.value.company.testbed_description, 'Ugnshall');
  const noContact = normalizeSparkInterview({ roles: [], company: { ...base, contact_ok: 'no' } });
  assert.equal(noContact.value.company.contact_name, undefined);
});

test('ett utkast får vara ofullständigt, inskick kräver de obligatoriska svaren', () => {
  const draft = normalizeSparkInterview({ roles: ['need_owner'], company: { name: 'Exempel AB' } });
  assert.ok(draft.ok);
  const submit = normalizeSparkInterview({ roles: ['need_owner'], company: { name: 'Exempel AB' } }, { submit: true });
  assert.ok(!submit.ok);
  assert.equal(submit.issue.section, 'start');
  const noNeed = normalizeSparkInterview({ roles: ['need_owner'], company: { ...base, need_matching: 'yes', pilot_interest: 'no', has_testbed: 'no' } }, { submit: true });
  assert.ok(!noNeed.ok);
  assert.equal(noNeed.issue.field, 'needs');
  const full = normalizeSparkInterview(
    { roles: ['need_owner'], company: { ...base, need_matching: 'yes', pilot_interest: 'yes', has_testbed: 'no' }, needs: [need] },
    { submit: true }
  );
  assert.ok(full.ok);
});

test('namnet krävs alltid och personnummer maskas i fritext', () => {
  assert.ok(!normalizeSparkInterview({ roles: [], company: {} }).ok);
  const r = normalizeSparkInterview({ roles: [], company: { ...base, development_areas: 'Kontakta 19850101-1234 om ugnen' } });
  assert.match(String(r.value.company.development_areas), /\[REDACTED\]/);
  assert.equal(normalizeSparkOrgNr('16556000-0000'), '556000-0000');
  assert.equal(normalizeSparkOrgNr('123'), '');
});

test('ett intervjusvar blir aktör, behov, lösningar och testmiljöer', () => {
  const r = normalizeSparkInterview({
    roles: ['need_owner', 'innovator'],
    company: { ...base, pilot_interest: 'maybe', has_testbed: 'yes', testbed_description: 'Ugnshall', testbed_areas: ['spillvarme'], need_matching: 'yes', solution_matching: 'yes' },
    needs: [{ ...need, _id: 'abc12345' }, { ...need, title: 'Spillvärme' }],
    solutions: [solution]
  });
  const d = deriveSparkRecords(r.value);
  assert.equal(d.actor.name, 'Exempel AB');
  assert.equal(d.actor.contact_email, 'kim@exempel.se');
  assert.equal(d.needs.length, 2);
  assert.equal(d.needs[0].source_key, 'need:abc12345');
  assert.notEqual(d.needs[0].source_key, d.needs[1].source_key);
  assert.equal(d.solutions[0].trl, 6);
  assert.equal(d.solutions[0].maturity, 4);
  assert.deepEqual(d.testbeds.map((t) => t.kind), ['test_environment', 'pilot_customer']);
});

test('kontaktuppgifter följer inte med när företaget sagt nej till kontakt', () => {
  const r = normalizeSparkInterview({ roles: [], company: { ...base, contact_ok: 'no' } });
  const d = deriveSparkRecords(r.value);
  assert.equal(d.actor.contact_ok, false);
  assert.equal(d.actor.contact_email, '');
});

test('anonym beskrivning och delningsnivå', () => {
  const a = { name: 'Exempel AB', sector: 'tillverkning', kommun: 'sandviken', size: 'medium' };
  assert.equal(sparkAnonymousActorLabel(a), 'Tillverkande industri i Sandviken (50–249 anställda)');
  assert.equal(sparkShareableName({ ...a, sharing: 'anonymous' }), 'Tillverkande industri i Sandviken (50–249 anställda)');
  assert.equal(sparkShareableName({ ...a, sharing: 'named' }), 'Exempel AB');
  assert.equal(sparkAnonymousActorLabel({}), 'Företag');
});

test('TRL: förslag till acceleratorkategori och vilka som bedöms', () => {
  assert.equal(suggestSparkAcceleratorCategory(2), 'early');
  assert.equal(suggestSparkAcceleratorCategory(4), 'candidate');
  assert.equal(suggestSparkAcceleratorCategory(7), 'candidate');
  assert.equal(suggestSparkAcceleratorCategory(9), 'market_ready');
  assert.equal(suggestSparkAcceleratorCategory(0), null);
  assert.equal(effectiveSparkTrl({ trl: 4, trl_assessed: 6 }), 6);
  assert.equal(effectiveSparkTrl({ trl: 4 }), 4);
  assert.equal(effectiveSparkTrl({}), null);
  assert.equal(sparkAcceleratorEligible({ roles: ['innovator'] }), true);
  assert.equal(sparkAcceleratorEligible({ roles: ['need_owner'] }), false, 'behovsägare bedöms inte');
  assert.equal(sparkAcceleratorEligible({ roles: ['innovator'], startup: 'abc' }), false, 'portföljbolag bedöms med IRL på bolagskortet');
});

const actors = new Map([
  ['a1', { id: 'a1', sector: 'tillverkning', kommun: 'sandviken', pilot_interest: 'yes', need_matching: 'yes' }],
  ['a2', { id: 'a2', sector: 'it_tjanster', kommun: 'sandviken', solution_matching: 'yes' }],
  ['a3', { id: 'a3', sector: 'it_tjanster', kommun: 'gavle', solution_matching: 'no' }]
]);
const mNeed = { id: 'n1', actor: 'a1', areas: ['flexibilitet_effektstyrning', 'annat'], priority: 'high', horizon: 'y1_3', unmet: 'yes', status: 'open' };
const mSol = { id: 's1', actor: 'a2', areas: ['flexibilitet_effektstyrning', 'annat'], target_sectors: ['tillverkning'], maturity: 4, needs: ['pilotkund'], status: 'active' };

test('matchning: gemensamt energiområde, bransch, mognad och pilot ger skäl i klartext', () => {
  const s = scoreNeedSolution(mNeed, mSol, actors);
  assert.ok(s);
  assert.deepEqual(s.sharedAreas, ['flexibilitet_effektstyrning'], '"Annat" räknas inte som gemensamt område');
  assert.equal(s.score, 4 + 3 + 2 + 1 + 2 + 1 + 1);
  assert.ok(s.reasons.some((r) => r.includes('pilotkund')));
  assert.ok(s.reasons.some((r) => r.includes('Sandviken')));
});

test('matchning: samma aktör, nej till matchning och ingen beröringspunkt föreslås inte', () => {
  assert.equal(scoreNeedSolution(mNeed, { ...mSol, actor: 'a1' }, actors), null);
  assert.equal(scoreNeedSolution(mNeed, { ...mSol, actor: 'a3' }, actors), null);
  assert.equal(scoreNeedSolution(mNeed, { ...mSol, areas: ['energilagring'], target_sectors: [] }, actors), null);
});

test('matchning: tidig lösning mot kort tidshorisont ger en varning', () => {
  const s = scoreNeedSolution({ ...mNeed, horizon: 'lt1' }, { ...mSol, maturity: 2 }, actors);
  assert.ok(s && s.cautions.some((c) => c.includes('inom ett år')));
});

test('rankning åt båda håll, redan matchade utesluts, testmiljöer föreslås', () => {
  const other = { ...mSol, id: 's2', areas: ['energilagring'], target_sectors: ['tillverkning'] };
  const ranked = rankSolutionsForNeed(mNeed, [other, mSol, { ...mSol, id: 's3', status: 'closed' }], actors);
  assert.deepEqual(ranked.map((r) => r.item.id), ['s1', 's2']);
  assert.deepEqual(rankSolutionsForNeed(mNeed, [mSol], actors, { exclude: new Set(['s1']) }), []);
  assert.deepEqual(rankNeedsForSolution(mSol, [mNeed, { ...mNeed, id: 'n2', status: 'solved' }], actors).map((r) => r.item.id), ['n1']);
  const beds = rankTestbedsForSolution(mSol, [{ id: 't1', actor: 'a1', kind: 'pilot_customer', areas: ['flexibilitet_effektstyrning'], status: 'available' }], actors);
  assert.equal(beds.length, 1);
  assert.ok(beds[0].reasons.some((r) => r.includes('pilotkund')));
});

test('luckorna: behov utan lösning och lösning utan behov', () => {
  const b = sparkAreaBalance(['flexibilitet_effektstyrning', 'energilagring', 'spillvarme'], [mNeed], [{ ...mSol, areas: ['energilagring'] }]);
  assert.deepEqual(b.map((x) => x.verdict), ['gap', 'surplus', 'empty']);
});

test('indikatorer räknar distinkta aktörer i aktiva matchningar', () => {
  const i = computeSparkIndicators({
    actors: [{ id: 'a1' }, { id: 'a2' }, { id: 'a4', actor_type: 'akademi' }],
    needs: [{ id: 'n1', actor: 'a1' }, { id: 'n2', actor: 'a1' }],
    solutions: [{ id: 's1', actor: 'a2' }, { id: 's4', actor: 'a4' }],
    testbeds: [],
    matches: [
      { status: 'suggested', need: 'n1', solution: 's1' },
      { status: 'pilot_running', need: 'n1', solution: 's1', support_kind: 'de_minimis', support_confirmed: true },
      { status: 'dialogue', need: 'n2', solution: 's4' }
    ]
  });
  assert.deepEqual(i, { needOwnersInvolved: 1, supportedCompanies: 1, structureUsers: 3, researchCollaborations: 1, pilots: 1 });
});

test('import: mallen går runt, etiketter och synonymer tolkas, okända värden varnas', () => {
  const cells = (line: string) => (line.match(/("(?:[^"]|"")*"|[^;]*)(;|$)/g) ?? []).slice(0, -1).map((c) => c.replace(/;$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const csv = buildSparkImportTemplateCsv().trim().split('\r\n').map(cells);
  assert.equal(csv[0].length, SPARK_IMPORT_COLUMNS.length);
  const parsed = parseSparkImportRows(csv[0], [csv[1]]);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 1);
  const a = parsed.rows[0].answers;
  assert.deepEqual(a.roles, ['need_owner', 'testbed']);
  assert.equal(a.company.size, 'medium');
  assert.equal(a.company.kommun, 'sandviken');
  assert.deepEqual(a.needs[0].areas, ['effekt_elnat', 'flexibilitet_effektstyrning']);
  assert.equal(a.needs[0].horizon, 'y1_3');

  const loose = parseSparkImportRows(
    ['företagsnamn', 'Lösning', 'Lösning – energiområden', 'TRL', 'Bransch', 'Okänd kolumn'],
    [
      ['Sol AB', 'Värmeåtervinnare', 'Spillvärme, Energilagring', 'TRL 5', 'Rymdindustri', 'x'],
      ['', 'utan namn', '', '', '', '']
    ]
  );
  assert.equal(loose.rows.length, 1);
  assert.deepEqual(loose.rows[0].roles, ['innovator'], 'rollen härleds när kolumnen saknas');
  assert.deepEqual(loose.rows[0].answers.solutions[0].areas, ['energilagring', 'spillvarme']);
  assert.equal(loose.rows[0].answers.solutions[0].trl, '5');
  assert.deepEqual(loose.unmappedHeaders, ['Okänd kolumn']);
  assert.ok(loose.warnings.some((w) => w.includes('"Bransch"') && w.includes('rad 2')));
  assert.ok(loose.warnings.some((w) => w.startsWith('Rad 3')));
});
