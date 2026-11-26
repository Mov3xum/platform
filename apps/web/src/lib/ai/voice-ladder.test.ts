import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LanguageHintMemory,
  resolveSpeechProviders,
  type SpeechProvider
} from './voice-transcription';
import { VoiceError, transcribeWithCandidates, type LadderDeps } from './voice-ladder';

// Hela anropskedjan för tal-till-text (CLAUDE.md § 31.2/§ 34) mot
// leverantörens VERKLIGA svar — API:t går inte att anropa från CI, och två
// incidenter (2026-09-11, 2026-11-26) satt i just den här logiken. `fetch`
// är en fejk som svarar som Mistral gör, utifrån modell och parametrar.

interface SeenRequest {
  url: string;
  model: string;
  language: string | null;
  contextBias: string[];
  diarize: boolean;
  hasFile: boolean;
}

type Responder = (req: SeenRequest) => { status: number; body: unknown } | Error;

function harness(responder: Responder, memory = new LanguageHintMemory()) {
  const requests: SeenRequest[] = [];
  const warnings: string[] = [];
  let clock = 0;
  const deps: LadderDeps = {
    fetch: (async (url: unknown, init?: { body?: unknown }) => {
      const form = init?.body as FormData;
      const req: SeenRequest = {
        url: String(url),
        model: String(form.get('model') ?? ''),
        language: form.has('language') ? String(form.get('language')) : null,
        contextBias: form.getAll('context_bias').map(String),
        diarize: form.get('diarize') === 'true',
        hasFile: form.get('file') instanceof Blob
      };
      requests.push(req);
      const out = responder(req);
      if (out instanceof Error) throw out;
      const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
      return new Response(text, { status: out.status });
    }) as unknown as typeof fetch,
    sleep: async () => {
      clock += 1000;
    },
    now: () => clock,
    memory,
    warn: (message) => warnings.push(message)
  };
  return { deps, requests, warnings, memory };
}

const AUDIO = new Uint8Array([1, 2, 3, 4]);
const mistral = () => resolveSpeechProviders({ MISTRAL_API_KEY: 'k' });

// Ordagrant ur skärmbilden 2026-11-26 (röstknappen i /chatt).
const V2_LANGUAGE_ERROR = {
  object: 'error',
  message:
    "Model 'voxtral-mini-transcribe-2602' does not support language 'sv', should be one of: " +
    "['ar', 'en', 'de', 'es', 'fr', 'hi', 'it', 'nl', 'pt', 'zh', 'ru', 'ko', 'ja']",
  type: 'invalid_request_error',
  param: null,
  code: null
};

const ok = (model: string, text = 'Hej och välkomna till mötet.') => ({
  status: 200,
  body: {
    model,
    text,
    language: null,
    segments: [],
    usage: { prompt_audio_seconds: 34, prompt_tokens: 3, total_tokens: 879, completion_tokens: 126 }
  }
});

test('standard: Voxtral 3 med svenska som språk — ett anrop, klart', async () => {
  const h = harness((req) => ok(req.model));
  const result = await transcribeWithCandidates(mistral(), AUDIO, 'audio/wav', {}, h.deps);
  assert.equal(result.text, 'Hej och välkomna till mötet.');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].model, 'voxtral-small-transcribe-3');
  assert.equal(h.requests[0].language, 'sv');
  assert.equal(h.requests[0].hasFile, true);
  assert.equal(result.provider, 'mistral');
  assert.equal(result.audioSeconds, 34);
  // Ljudtokens räknas in i ingången (879 totalt − 126 ut).
  assert.deepEqual(result.usage, { tokensIn: 753, tokensOut: 126 });
});

test('incidenten 2026-11-26: gamla modellen avvisar `sv` med NY formulering → autodetekt, och det minns', async () => {
  const legacy: SpeechProvider[] = resolveSpeechProviders({ MISTRAL_API_KEY: 'k' }).filter(
    (p) => p.model === 'voxtral-mini-latest'
  );
  const h = harness((req) =>
    req.language ? { status: 400, body: V2_LANGUAGE_ERROR } : ok('voxtral-mini-transcribe-2602')
  );
  const first = await transcribeWithCandidates(legacy, AUDIO, 'audio/wav', {}, h.deps);
  assert.equal(first.text, 'Hej och välkomna till mötet.');
  assert.deepEqual(
    h.requests.map((r) => r.language),
    ['sv', null]
  );
  // Nästa segment går rätt från början — ingen extra rundtur.
  await transcribeWithCandidates(legacy, AUDIO, 'audio/wav', {}, h.deps);
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].language, null);
});

test('okänd felformulering: hintet släpps ändå (trappan hänger inte på ordalydelsen)', async () => {
  const provider = mistral().slice(0, 1);
  const h = harness((req) =>
    req.language
      ? { status: 400, body: { object: 'error', message: 'Bad request (code 4711)' } }
      : ok(req.model)
  );
  const result = await transcribeWithCandidates(
    provider,
    AUDIO,
    'audio/wav',
    { contextBias: ['Movexum'] },
    h.deps
  );
  assert.equal(result.text, 'Hej och välkomna till mötet.');
  // 1) allt, 2) utan extraparametrar, 3) utan språkhint.
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[0].contextBias, ['Movexum']);
  assert.deepEqual(h.requests[1].contextBias, []);
  assert.equal(h.requests[1].language, 'sv');
  assert.equal(h.requests[2].language, null);
  // Belagt att hintet var orsaken ⇒ nästa anrop skickar ordlistan men inte hintet.
  await transcribeWithCandidates(provider, AUDIO, 'audio/wav', { contextBias: ['Movexum'] }, h.deps);
  assert.equal(h.requests.length, 4);
  assert.equal(h.requests[3].language, null);
  assert.deepEqual(h.requests[3].contextBias, ['Movexum']);
});

test('Mistrals 422 (validering av language) släpper hintet', async () => {
  const provider = mistral().slice(0, 1);
  const h = harness((req) =>
    req.language
      ? {
          status: 422,
          body: {
            object: 'error',
            message: { detail: [{ loc: ['body', 'language'], msg: 'Invalid language alpha2 code' }] }
          }
        }
      : ok(req.model)
  );
  const result = await transcribeWithCandidates(provider, AUDIO, 'audio/wav', {}, h.deps);
  assert.ok(result.text);
  assert.deepEqual(
    h.requests.map((r) => r.language),
    ['sv', null]
  );
});

test('kontot saknar Voxtral 3 ("Invalid model") → nästa modell, och den okända modellen frågas inte igen', async () => {
  const h = harness((req) => {
    if (req.model.includes('transcribe-3')) {
      return { status: 400, body: { object: 'error', message: `Invalid model: ${req.model}` } };
    }
    return req.language ? { status: 400, body: V2_LANGUAGE_ERROR } : ok('voxtral-mini-transcribe-2602');
  });
  const result = await transcribeWithCandidates(mistral(), AUDIO, 'audio/wav', {}, h.deps);
  assert.equal(result.model, 'voxtral-mini-transcribe-2602');
  assert.deepEqual(
    h.requests.map((r) => `${r.model}:${r.language ?? 'auto'}`),
    [
      'voxtral-small-transcribe-3:sv',
      'voxtral-mini-transcribe-3:sv',
      'voxtral-mini-latest:sv',
      'voxtral-mini-latest:auto'
    ]
  );
  // Andra segmentet: ett enda anrop, direkt mot modellen som fungerar.
  await transcribeWithCandidates(mistral(), AUDIO, 'audio/wav', {}, h.deps);
  assert.equal(h.requests.length, 5);
  assert.equal(`${h.requests[4].model}:${h.requests[4].language ?? 'auto'}`, 'voxtral-mini-latest:auto');
});

test('extraparametrar som modellen avvisar stryks — språkhintet behålls', async () => {
  const provider = mistral().slice(0, 1);
  const h = harness((req) =>
    req.diarize
      ? { status: 422, body: { object: 'error', message: 'diarize is not supported for this model' } }
      : ok(req.model)
  );
  const result = await transcribeWithCandidates(
    provider,
    AUDIO,
    'audio/wav',
    { contextBias: ['Movexum'], diarize: true },
    h.deps
  );
  assert.ok(result.text);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].language, 'sv');
  assert.equal(h.requests[1].diarize, false);
});

test('överbelastad modell (429) → försök igen, sedan nästa modell', async () => {
  const h = harness((req) =>
    req.model === 'voxtral-small-transcribe-3'
      ? { status: 429, body: { message: 'Rate limit exceeded' } }
      : ok(req.model)
  );
  const result = await transcribeWithCandidates(mistral(), AUDIO, 'audio/wav', {}, h.deps);
  assert.equal(result.model, 'voxtral-mini-transcribe-3');
  assert.equal(h.requests.filter((r) => r.model === 'voxtral-small-transcribe-3').length, 3);
});

test('nätverksfel hos den egna endpointen → Voxtral tar över', async () => {
  const providers = resolveSpeechProviders({
    MISTRAL_API_KEY: 'k',
    MOVEXUM_STT_BASE_URL: 'https://api.berget.ai/v1',
    MOVEXUM_STT_API_KEY: 'b'
  });
  const h = harness((req) =>
    req.url.includes('berget') ? new TypeError('fetch failed') : ok(req.model)
  );
  const result = await transcribeWithCandidates(providers, AUDIO, 'audio/wav', {}, h.deps);
  assert.equal(result.provider, 'mistral');
  assert.equal(h.requests[0].url, 'https://api.berget.ai/v1/audio/transcriptions');
  assert.equal(h.requests[0].model, 'KBLab/kb-whisper-large');
});

test('fel nyckel hos den egna endpointen (401) → Voxtral tar över; fel Mistral-nyckel provas inte tre gånger', async () => {
  const providers = resolveSpeechProviders({
    MISTRAL_API_KEY: 'k',
    MOVEXUM_STT_BASE_URL: 'https://stt.example.se'
  });
  const sovereignDown = harness((req) =>
    req.url.includes('stt.example.se') ? { status: 401, body: 'Unauthorized' } : ok(req.model)
  );
  const result = await transcribeWithCandidates(providers, AUDIO, 'audio/wav', {}, sovereignDown.deps);
  assert.equal(result.provider, 'mistral');

  const badKey = harness(() => ({ status: 401, body: { message: 'Unauthorized' } }));
  await assert.rejects(
    () => transcribeWithCandidates(mistral(), AUDIO, 'audio/wav', {}, badKey.deps),
    (err: unknown) => err instanceof VoiceError && err.status === 502 && /MISTRAL_API_KEY/.test(err.message)
  );
  assert.equal(badKey.requests.length, 1);
});

test('tomt transkript: ett omförsök med autodetekt, sedan 422 med förbrukningen — ALDRIG nästa modell', async () => {
  const h = harness((req) => ok(req.model, '   '));
  await assert.rejects(
    () => transcribeWithCandidates(mistral(), AUDIO, 'audio/wav', {}, h.deps),
    (err: unknown) => {
      assert.ok(err instanceof VoiceError);
      assert.equal(err.status, 422);
      assert.equal(err.failover, false);
      // Båda anropen bearbetade ljudet → båda bokförs.
      assert.deepEqual(err.usage, { tokensIn: 1506, tokensOut: 252 });
      assert.equal(err.audioSeconds, 34);
      return true;
    }
  );
  assert.deepEqual(
    h.requests.map((r) => `${r.model}:${r.language ?? 'auto'}`),
    ['voxtral-small-transcribe-3:sv', 'voxtral-small-transcribe-3:auto']
  );
});

test('avvisat av alla kandidater → läsbart fel utan rå JSON', async () => {
  const h = harness(() => ({
    status: 400,
    body: { object: 'error', message: 'Audio file is corrupted', type: 'invalid_request_error' }
  }));
  await assert.rejects(
    () => transcribeWithCandidates(mistral(), AUDIO, 'audio/wav', {}, h.deps),
    (err: unknown) => {
      assert.ok(err instanceof VoiceError);
      assert.equal(err.status, 400);
      assert.match(err.message, /rösttjänsten svarade: Audio file is corrupted$/);
      assert.doesNotMatch(err.message, /\{|"object"/);
      return true;
    }
  );
});

test('inga kandidater konfigurerade → tydligt 503', async () => {
  const h = harness(() => ok('x'));
  await assert.rejects(
    () => transcribeWithCandidates([], AUDIO, 'audio/wav', {}, h.deps),
    (err: unknown) => err instanceof VoiceError && err.status === 503
  );
  assert.equal(h.requests.length, 0);
});
