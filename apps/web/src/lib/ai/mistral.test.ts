import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callMistral, callMistralConversation, callMistralWithFallback, estimateCostUsd } from './mistral';

/**
 * Kör Mistral-klienten mot en fejkad `fetch` som svarar som API:t gör med
 * Mistral Large 4 / Small 4 (docs.mistral.ai → Reasoning, läst 2026-11-26):
 * innehåll i delar (resonemang + text), strömmar som byter form, en fäst
 * modellversion som inte längre finns och en avvisad resonemangsnivå.
 */

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

type Responder = (sent: Sent, index: number) => Response;

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };
let sent: Sent[] = [];

function mockFetch(responder: Responder) {
  sent = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const entry: Sent = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    };
    sent.push(entry);
    return responder(entry, sent.length - 1);
  }) as typeof fetch;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function completion(content: unknown, extra: Record<string, unknown> = {}): Response {
  return json(200, {
    choices: [{ message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 25, completion_tokens: 187 }
  });
}

function sse(events: unknown[]): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
  process.env.MISTRAL_API_KEY = 'test-key';
  delete process.env.MISTRAL_API_BASE_URL;
  delete process.env.MISTRAL_FALLBACK_BASE_URL;
  delete process.env.MISTRAL_MODEL_LARGE;
  delete process.env.MISTRAL_MODEL_SMALL;
  delete process.env.MISTRAL_LARGE_REASONING_EFFORT;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
});

const THINK = { type: 'thinking', thinking: [{ type: 'text', text: '17 * 20 = 340, 17 * 3 = 51.' }] };

test('Large 4: fäst version, resonemangsnivå och marginal skickas; svar i delar blir text', async () => {
  mockFetch(() => completion([THINK, { type: 'text', text: '17 * 23 = 391.' }]));
  const res = await callMistral('mistral-large-latest', [{ role: 'user', content: 'Vad är 17 * 23?' }]);
  assert.equal(res.text, '17 * 23 = 391.');
  assert.deepEqual(res.usage, { prompt_tokens: 25, completion_tokens: 187 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.mistral.ai/v1/chat/completions');
  assert.equal(sent[0].body.model, 'mistral-large-4-0');
  assert.equal(sent[0].body.reasoning_effort, 'medium');
  // 4000 för svaret + marginal för resonemanget (medium).
  assert.equal(sent[0].body.max_tokens, 7000);
});

test('Small 4: fäst version, inget resonemang, ingen marginal; sträng som den är', async () => {
  mockFetch(() => completion('Kort svar.'));
  const res = await callMistral('mistral-small-latest', [{ role: 'user', content: 'hej' }], {
    maxTokens: 200
  });
  assert.equal(res.text, 'Kort svar.');
  assert.equal(sent[0].body.model, 'mistral-small-2603');
  assert.equal(sent[0].body.reasoning_effort, 'none');
  assert.equal(sent[0].body.max_tokens, 200);
});

test('avvecklat id (Medium, Pixtral) körs som Large 4', async () => {
  mockFetch(() => completion('ok'));
  await callMistral('mistral-medium-latest', [{ role: 'user', content: 'hej' }]);
  await callMistral('pixtral-large-latest', [{ role: 'user', content: 'hej' }]);
  assert.deepEqual(sent.map((s) => s.body.model), ['mistral-large-4-0', 'mistral-large-4-0']);
});

test('anroparens nivå vinner; en nivå modellen saknar flyttas nedåt', async () => {
  mockFetch(() => completion('ok'));
  await callMistral('mistral-large-latest', [{ role: 'user', content: 'x' }], {
    reasoningEffort: 'high',
    maxTokens: 8000
  });
  await callMistral('mistral-small-latest', [{ role: 'user', content: 'x' }], {
    reasoningEffort: 'low'
  });
  assert.equal(sent[0].body.reasoning_effort, 'high');
  assert.equal(sent[0].body.max_tokens, 16000);
  assert.equal(sent[1].body.reasoning_effort, 'none');
});

test('tom text + verktygsanrop: innehåll null ger tom sträng, anropen följer med', async () => {
  const toolCalls = [{ id: 'a1', type: 'function', function: { name: 'query_collection', arguments: '{}' } }];
  mockFetch(() => completion(null, { tool_calls: toolCalls }));
  const res = await callMistral('mistral-large-latest', [{ role: 'user', content: 'x' }]);
  assert.equal(res.text, '');
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].function.name, 'query_collection');
});

test('ström: resonemangsfas, övergångsdelta och svarsfas — bara svaret strömmas', async () => {
  mockFetch(() =>
    sse([
      { choices: [{ delta: { role: 'assistant', content: [THINK] } }] },
      { choices: [{ delta: { content: [{ type: 'thinking', thinking: [{ type: 'text', text: ' Klart.' }] }] } }] },
      // Övergången: sista thinking-delen OCH första textdelen i samma lista.
      {
        choices: [
          {
            delta: {
              content: [
                { type: 'thinking', thinking: [{ type: 'text', text: '' }] },
                { type: 'text', text: '17 * 23 ' }
              ]
            }
          }
        ]
      },
      { choices: [{ delta: { content: '= 391' } }] },
      { choices: [{ delta: { content: '.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 25, completion_tokens: 190 } }
    ])
  );
  const tokens: string[] = [];
  const res = await callMistral('mistral-large-latest', [{ role: 'user', content: 'Vad är 17 * 23?' }], {
    onToken: (t) => tokens.push(t)
  });
  assert.equal(sent[0].body.stream, true);
  assert.deepEqual(tokens, ['17 * 23 ', '= 391', '.']);
  assert.equal(res.text, '17 * 23 = 391.');
  assert.deepEqual(res.usage, { prompt_tokens: 25, completion_tokens: 190 });
});

test('avvisad resonemangsnivå: samma modell en gång till utan parametern', async () => {
  mockFetch((s) =>
    'reasoning_effort' in s.body
      ? json(422, { detail: [{ loc: ['body', 'reasoning_effort'], msg: 'Input should be low, medium or high' }] })
      : completion('ok utan nivå')
  );
  const res = await callMistral('mistral-large-latest', [{ role: 'user', content: 'x' }]);
  assert.equal(res.text, 'ok utan nivå');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.model, 'mistral-large-4-0');
  assert.equal('reasoning_effort' in sent[1].body, false);
  // Utan resonemangsparameter: ingen marginal.
  assert.equal(sent[1].body.max_tokens, 4000);
});

test('andra fel kastas direkt — inget omförsök på en för lång prompt', async () => {
  mockFetch(() => json(400, { message: 'Prompt contains 300000 tokens, too large for model with 256000 maximum context length' }));
  await assert.rejects(
    () => callMistral('mistral-small-latest', [{ role: 'user', content: 'x' }]),
    (err: unknown) => err instanceof Error && /Mistral API-fel 400/.test(err.message)
  );
  assert.equal(sent.length, 1);
});

test('Conversations-API:t: fäst version och nivå i completion_args', async () => {
  mockFetch(() =>
    json(200, {
      outputs: [
        { type: 'tool.execution', name: 'web_search' },
        {
          type: 'message.output',
          role: 'assistant',
          content: [
            THINK,
            { type: 'text', text: 'Enligt källan' },
            { type: 'tool_reference', tool: 'web_search', title: 'SCB', url: 'https://www.scb.se/x' },
            { type: 'text', text: '.' }
          ]
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 }
    })
  );
  const res = await callMistralConversation(
    'mistral-large-latest',
    [
      { role: 'system', content: 'Sök.' },
      { role: 'user', content: 'Hur många startups finns i Sverige?' }
    ],
    { builtins: ['web_search'], maxTokens: 1500, reasoningEffort: 'low' }
  );
  assert.equal(res.text, 'Enligt källan [1].');
  assert.equal(res.references?.length, 1);
  assert.equal(sent[0].url, 'https://api.mistral.ai/v1/conversations');
  assert.equal(sent[0].body.model, 'mistral-large-4-0');
  const args = sent[0].body.completion_args as Record<string, unknown>;
  assert.equal(args.reasoning_effort, 'low');
  assert.equal(args.max_tokens, 2500);
});

test('estimateCostUsd: registrets listpriser, avvecklat id prissätts som ersättaren', () => {
  assert.equal(estimateCostUsd('mistral-large-latest', 1_000_000, 1_000_000).toFixed(2), '2.80');
  assert.equal(estimateCostUsd('mistral-medium-latest', 1_000_000, 0).toFixed(2), '0.70');
  assert.equal(estimateCostUsd('mistral-small-latest', 1_000_000, 1_000_000).toFixed(2), '0.75');
  assert.equal(estimateCostUsd('mistral-embed', 1_000_000, 0).toFixed(2), '0.10');
});

// De här två körs SIST: de lär klienten att en fäst version är avvisad
// (processminne), vilket annars skulle påverka testerna ovan.

test('fäst version okänd för API:t: aliaset provas utan nivå och det avvisade id:t minns', async () => {
  mockFetch((s) =>
    s.body.model === 'mistral-small-2603'
      ? json(400, { object: 'error', message: 'Invalid model: mistral-small-2603' })
      : completion('svar via alias')
  );
  const first = await callMistral('mistral-small-latest', [{ role: 'user', content: 'x' }]);
  assert.equal(first.text, 'svar via alias');
  assert.deepEqual(sent.map((s) => s.body.model), ['mistral-small-2603', 'mistral-small-latest']);
  assert.equal('reasoning_effort' in sent[1].body, false);

  // Nästa anrop börjar direkt på aliaset.
  await callMistral('mistral-small-latest', [{ role: 'user', content: 'x' }]);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].body.model, 'mistral-small-latest');
});

test('kedja: dubbletter efter normalisering tas bort; en modell som inte finns ger nästa', async () => {
  mockFetch((s) =>
    String(s.body.model).startsWith('mistral-large')
      ? json(404, { message: 'Model not found' })
      : completion('small svarade')
  );
  const res = await callMistralWithFallback(
    ['mistral-medium-latest', 'mistral-large-latest', 'mistral-small-latest'],
    [{ role: 'user', content: 'x' }]
  );
  assert.equal(res.text, 'small svarade');
  assert.equal(res.modelUsed, 'mistral-small-latest');
  // Large provas EN gång (fäst version + alias), inte två gånger för att
  // Medium och Large normaliseras till samma modell.
  assert.deepEqual(sent.map((s) => s.body.model), [
    'mistral-large-4-0',
    'mistral-large-latest',
    'mistral-small-latest'
  ]);
});
