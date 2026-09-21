import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SOVEREIGN_STT_MODEL,
  DEFAULT_VOICE_MODEL,
  LanguageHintMemory,
  MAX_CONTEXT_BIAS_TERMS,
  MEETING_CONTEXT_VOCABULARY,
  addUsage,
  buildContextBias,
  isDiarizationEnabled,
  normalizeLanguageHint,
  parseTranscriptionPayload,
  parseUnsupportedLanguage,
  resolveSpeechProviders,
  transcriptionsUrlFor,
  turnsFromSegments
} from './voice-transcription';

// Låser tal-till-text-logiken (CLAUDE.md § 31/§ 34): providerresolvning,
// språkhint-hantering (incidenten 2026-09-11) och tolkning av API-svar.

test('transcriptionsUrlFor trimmar trailing slash och lägger rätt path', () => {
  assert.equal(transcriptionsUrlFor('https://api.mistral.ai'), 'https://api.mistral.ai/v1/audio/transcriptions');
  assert.equal(transcriptionsUrlFor('https://stt.eu.local//'), 'https://stt.eu.local/v1/audio/transcriptions');
});

test('normalizeLanguageHint: auto/tomt/skräp ⇒ autodetekt, ISO-kod ⇒ gemener', () => {
  assert.equal(normalizeLanguageHint('sv'), 'sv');
  assert.equal(normalizeLanguageHint(' SV '), 'sv');
  assert.equal(normalizeLanguageHint('sv-se'), 'sv-se');
  assert.equal(normalizeLanguageHint('auto'), '');
  assert.equal(normalizeLanguageHint('none'), '');
  assert.equal(normalizeLanguageHint(''), '');
  assert.equal(normalizeLanguageHint(undefined), '');
  assert.equal(normalizeLanguageHint('svenska'), '');
  assert.equal(normalizeLanguageHint('sv; drop table'), '');
});

test('resolveSpeechProviders: utan nycklar finns inga providers', () => {
  assert.deepEqual(resolveSpeechProviders({}), []);
});

test('resolveSpeechProviders: default = exakt EN provider (Voxtral, EU) med sv-hint', () => {
  const providers = resolveSpeechProviders({ MISTRAL_API_KEY: 'k1' });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].label, 'mistral');
  assert.equal(providers[0].kind, 'mistral');
  assert.equal(providers[0].url, 'https://api.mistral.ai/v1/audio/transcriptions');
  assert.equal(providers[0].model, DEFAULT_VOICE_MODEL);
  assert.equal(providers[0].language, 'sv');
  assert.equal(providers[0].apiKey, 'k1');
});

test('resolveSpeechProviders: env överstyr modell, bas och språkhint (auto = av)', () => {
  const [p] = resolveSpeechProviders({
    MISTRAL_API_KEY: 'k1',
    MISTRAL_API_BASE_URL: 'https://eu.local/',
    MISTRAL_VOICE_MODEL: 'voxtral-small-latest',
    MISTRAL_VOICE_LANGUAGE: 'auto'
  });
  assert.equal(p.url, 'https://eu.local/v1/audio/transcriptions');
  assert.equal(p.model, 'voxtral-small-latest');
  assert.equal(p.language, '');
  // Coolify skickar tomma strängar för osatta variabler — det är "osatt", inte "auto".
  const [blank] = resolveSpeechProviders({
    MISTRAL_API_KEY: 'k1',
    MISTRAL_VOICE_MODEL: '',
    MISTRAL_VOICE_LANGUAGE: '   '
  });
  assert.equal(blank.model, DEFAULT_VOICE_MODEL);
  assert.equal(blank.language, 'sv');
});

test('resolveSpeechProviders: självhostad EU-provider går FÖRST, Voxtral blir fallback', () => {
  const providers = resolveSpeechProviders({
    MISTRAL_API_KEY: 'k1',
    MOVEXUM_STT_BASE_URL: 'https://stt.upcloud.local'
  });
  assert.equal(providers.length, 2);
  assert.equal(providers[0].label, 'sovereign');
  assert.equal(providers[0].kind, 'openai');
  assert.equal(providers[0].url, 'https://stt.upcloud.local/v1/audio/transcriptions');
  assert.equal(providers[0].model, DEFAULT_SOVEREIGN_STT_MODEL);
  assert.equal(providers[0].language, 'sv');
  assert.equal(providers[0].apiKey, '');
  assert.equal(providers[1].label, 'mistral');
});

test('resolveSpeechProviders: självhostad provider fungerar utan Mistral-nyckel', () => {
  const providers = resolveSpeechProviders({
    MOVEXUM_STT_BASE_URL: 'http://stt:8000',
    MOVEXUM_STT_API_KEY: 'local',
    MOVEXUM_STT_MODEL: 'KBLab/kb-whisper-medium',
    MOVEXUM_STT_LANGUAGE: 'auto'
  });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].apiKey, 'local');
  assert.equal(providers[0].model, 'KBLab/kb-whisper-medium');
  assert.equal(providers[0].language, '');
});

test('parseUnsupportedLanguage tolkar Mistrals faktiska 400-svar (incidenten)', () => {
  const body =
    '{"object":"error","message":"Got unsupported language `sv`, should be one of: ' +
    "['ar', 'en', 'de', 'es', 'fr', 'hi', 'it', 'nl', 'pt', 'zh', 'ru', 'ko', 'ja']\"," +
    '"type":"invalid_request_error","param":null,"code":null}';
  const info = parseUnsupportedLanguage(body);
  assert.ok(info);
  assert.equal(info.language, 'sv');
  assert.deepEqual(info.supported, [
    'ar', 'en', 'de', 'es', 'fr', 'hi', 'it', 'nl', 'pt', 'zh', 'ru', 'ko', 'ja'
  ]);
});

test('parseUnsupportedLanguage: tolerant mot citattecken och saknad lista', () => {
  assert.deepEqual(parseUnsupportedLanguage('Unsupported language "sv"'), {
    language: 'sv',
    supported: []
  });
  assert.equal(parseUnsupportedLanguage('unsupported language: nb-no.')?.language, 'nb-no');
});

test('parseUnsupportedLanguage: andra fel (format, auth) ⇒ null', () => {
  assert.equal(parseUnsupportedLanguage(''), null);
  assert.equal(parseUnsupportedLanguage('{"message":"Unsupported audio format"}'), null);
  assert.equal(parseUnsupportedLanguage('{"message":"Unauthorized"}'), null);
});

test('LanguageHintMemory minns avvisade hint per provider+modell, med TTL', () => {
  const memory = new LanguageHintMemory(1000);
  const voxtral = { url: 'https://api.mistral.ai/v1/audio/transcriptions', model: 'voxtral-mini-latest' };
  const whisper = { url: 'https://stt.local/v1/audio/transcriptions', model: 'kb-whisper' };
  assert.equal(memory.isRejected(voxtral, 'sv', 0), false);
  memory.reject(voxtral, 'sv', 0);
  assert.equal(memory.isRejected(voxtral, 'sv', 500), true);
  // Annan provider/modell/språk påverkas inte.
  assert.equal(memory.isRejected(whisper, 'sv', 500), false);
  assert.equal(memory.isRejected(voxtral, 'en', 500), false);
  assert.equal(memory.isRejected({ ...voxtral, model: 'voxtral-small-latest' }, 'sv', 500), false);
  // Tomt hint är aldrig "avvisat".
  assert.equal(memory.isRejected(voxtral, '', 500), false);
  // TTL: efter fönstret prövas hintet igen (modelluppgradering utan omstart).
  assert.equal(memory.isRejected(voxtral, 'sv', 1001), false);
  assert.equal(memory.size, 0);
});

test('buildContextBias dedupe:ar skiftlägesokänsligt, trimmar och cappar', () => {
  const terms = buildContextBias(['Movexum', ' movexum ', '', null, undefined, '  Almi  Invest ', 'Almi Invest']);
  assert.deepEqual(terms, ['Movexum', 'Almi Invest']);
  const many = buildContextBias(Array.from({ length: 100 }, (_, i) => `term${i}`));
  assert.equal(many.length, MAX_CONTEXT_BIAS_TERMS);
  const long = buildContextBias(['x'.repeat(200)]);
  assert.equal(long[0].length, 60);
});

test('buildContextBias: bolagsnamnet först, sedan ordlistan — ordningen bevaras', () => {
  const terms = buildContextBias(['Fixkod AB', ...MEETING_CONTEXT_VOCABULARY]);
  assert.equal(terms[0], 'Fixkod AB');
  assert.equal(terms[1], MEETING_CONTEXT_VOCABULARY[0]);
});

test('ordlistan innehåller bara verksamhetstermer — inga e-postadresser/nummer', () => {
  for (const term of MEETING_CONTEXT_VOCABULARY) {
    assert.ok(!/@|\d{6,}/.test(term), `misstänkt PII i ordlistan: ${term}`);
  }
});

test('turnsFromSegments slår ihop efterföljande segment med samma talare', () => {
  const turns = turnsFromSegments([
    { text: 'Hur går ', speaker_id: 'speaker_0', start: 0, end: 1 },
    { text: 'försäljningen?', speaker_id: 'speaker_0', start: 1, end: 2 },
    { text: 'Bra.', speaker_id: 'speaker_1', start: 2, end: 3 },
    { text: '   ', speaker_id: 'speaker_1', start: 3, end: 4 },
    { text: 'Nästa steg?', speaker_id: 'speaker_0', start: 4, end: 5 }
  ]);
  assert.deepEqual(turns, [
    { speaker: 'S1', text: 'Hur går försäljningen?' },
    { speaker: 'S2', text: 'Bra.' },
    { speaker: 'S1', text: 'Nästa steg?' }
  ]);
});

test('turnsFromSegments: utan talar-id (diarisering av) ⇒ undefined', () => {
  assert.equal(turnsFromSegments([{ text: 'Hej', start: 0, end: 1 }]), undefined);
  assert.equal(turnsFromSegments(undefined), undefined);
  assert.equal(turnsFromSegments([]), undefined);
});

test('parseTranscriptionPayload läser text, språk, usage och turer; usage saknas ⇒ 0', () => {
  const provider = { label: 'mistral' as const, model: 'voxtral-mini-latest' };
  const full = parseTranscriptionPayload(
    {
      model: 'voxtral-mini-2602',
      text: '  Vi bokar ett uppföljningsmöte.  ',
      language: 'SV',
      usage: { prompt_tokens: 1200, completion_tokens: 40, prompt_audio_seconds: 88 },
      segments: [
        { text: 'Vi bokar', speaker_id: 'speaker_0' },
        { text: 'ett uppföljningsmöte.', speaker_id: 'speaker_1' }
      ]
    },
    provider
  );
  assert.equal(full.text, 'Vi bokar ett uppföljningsmöte.');
  assert.equal(full.model, 'voxtral-mini-2602');
  assert.equal(full.provider, 'mistral');
  assert.equal(full.language, 'sv');
  assert.deepEqual(full.usage, { tokensIn: 1200, tokensOut: 40 });
  assert.equal(full.audioSeconds, 88);
  assert.equal(full.turns?.length, 2);

  const bare = parseTranscriptionPayload({ text: 'hej' }, { label: 'sovereign', model: 'kb-whisper' });
  assert.equal(bare.model, 'kb-whisper');
  assert.equal(bare.provider, 'sovereign');
  assert.deepEqual(bare.usage, { tokensIn: 0, tokensOut: 0 });
  assert.equal(bare.audioSeconds, undefined);
  assert.equal(bare.turns, undefined);
  assert.equal(bare.language, undefined);

  const empty = parseTranscriptionPayload(null, provider);
  assert.equal(empty.text, '');
});

test('isDiarizationEnabled: AV som default, på för 1/true/on/yes', () => {
  assert.equal(isDiarizationEnabled({}), false);
  assert.equal(isDiarizationEnabled({ MOVEXUM_MEETING_DIARIZATION: '0' }), false);
  assert.equal(isDiarizationEnabled({ MOVEXUM_MEETING_DIARIZATION: 'false' }), false);
  assert.equal(isDiarizationEnabled({ MOVEXUM_MEETING_DIARIZATION: '1' }), true);
  assert.equal(isDiarizationEnabled({ MOVEXUM_MEETING_DIARIZATION: ' TRUE ' }), true);
  assert.equal(isDiarizationEnabled({ MOVEXUM_MEETING_DIARIZATION: 'on' }), true);
  assert.equal(isDiarizationEnabled({ MOVEXUM_MEETING_DIARIZATION: 'yes' }), true);
});

test('addUsage summerar båda riktningarna', () => {
  assert.deepEqual(addUsage({ tokensIn: 10, tokensOut: 2 }, { tokensIn: 5, tokensOut: 1 }), {
    tokensIn: 15,
    tokensOut: 3
  });
});
