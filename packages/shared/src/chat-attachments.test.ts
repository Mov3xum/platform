import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_ATTACHMENT_MAX_PROMPT_CHARS,
  applyChatAttachmentPersistBudget,
  buildChatAttachmentBlock,
  buildChatPromptMessages,
  capChatAttachmentText,
  readChatMessageAttachments,
  sanitizeChatAttachmentText,
  withoutChatAttachmentText,
  type ChatMessageAttachment
} from './chat-attachments';

const pdf = (name: string, text: string): ChatMessageAttachment => ({
  name,
  mime: 'application/pdf',
  kind: 'text',
  chars: text.length,
  text
});

test('sanitize: maskar personnummer och styrtecken, normaliserar radbrytningar', () => {
  assert.equal(
    sanitizeChatAttachmentText('Anna 19900101-1234\r\nrad\u0000två'),
    'Anna [REDACTED]\nradtvå'
  );
});

test('cap: kapar och markerar', () => {
  assert.deepEqual(capChatAttachmentText('abcdef', 3), { text: 'abc', truncated: true });
  assert.deepEqual(capChatAttachmentText('abc', 3), { text: 'abc', truncated: false });
});

test('blocket för aktuell tur säger att filen är bifogad och INTE ligger i Filer', () => {
  const { block, used } = buildChatAttachmentBlock([pdf('Affärsplan.pdf', 'Vi säljer pallar.')], {
    current: true,
    budget: 1000
  });
  assert.match(block, /BIFOGADE FILER I DETTA MEDDELANDE/);
  assert.match(block, /read_my_file/);
  assert.match(block, /Affärsplan\.pdf/);
  assert.match(block, /Vi säljer pallar\./);
  assert.equal(used, 'Vi säljer pallar.'.length);
});

test('blocket respekterar budgeten och säger när innehållet inte ryms', () => {
  const { block } = buildChatAttachmentBlock(
    [pdf('a.pdf', 'x'.repeat(50)), pdf('b.pdf', 'y'.repeat(50))],
    { current: true, budget: 60 }
  );
  assert.match(block, /bara de första 10 tecknen ryms/);
  const empty = buildChatAttachmentBlock([pdf('c.pdf', 'z'.repeat(10))], { current: false, budget: 0 });
  assert.match(empty.block, /ryms inte/);
  assert.equal(empty.used, 0);
});

test('bilder i tidigare tur → not om att bilden bara syntes då', () => {
  const { block } = buildChatAttachmentBlock(
    [{ name: 'skärm.png', mime: 'image/png', kind: 'image' }],
    { current: false, budget: 1000 }
  );
  assert.match(block, /skärm\.png/);
  assert.match(block, /bifoga den på nytt/);
});

test('prompten: en fil från första turen följer med i senare turer', () => {
  const msgs = buildChatPromptMessages([
    { role: 'user', content: 'Läs den här', attachments: [pdf('plan.pdf', 'INNEHÅLL')] },
    { role: 'assistant', content: 'Klart.' },
    { role: 'user', content: 'Vad står det i punkt 2?' }
  ]);
  assert.equal(msgs.length, 3);
  assert.match(msgs[0].content, /FILER SOM BIFOGADES I DETTA TIDIGARE MEDDELANDE/);
  assert.match(msgs[0].content, /INNEHÅLL/);
  assert.equal(msgs[2].content, 'Vad står det i punkt 2?');
});

test('prompten: aktuell tur prioriteras i budgeten före äldre bilagor', () => {
  const big = 'a'.repeat(CHAT_ATTACHMENT_MAX_PROMPT_CHARS);
  const msgs = buildChatPromptMessages([
    { role: 'user', content: 'gammal', attachments: [pdf('old.pdf', 'GAMMALT')] },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'ny', attachments: [pdf('new.pdf', big)] }
  ]);
  assert.ok(msgs[2].content.includes(big));
  assert.ok(!msgs[0].content.includes('GAMMALT'));
  assert.match(msgs[0].content, /ryms inte/);
});

test('persist-budget: nyaste behåller texten, äldsta rensas men metadata finns kvar', () => {
  const messages = [
    { role: 'user', chat_attachments: [pdf('old.pdf', 'o'.repeat(8))] },
    { role: 'assistant' },
    { role: 'user', chat_attachments: [pdf('new.pdf', 'n'.repeat(8))] }
  ];
  const out = applyChatAttachmentPersistBudget(messages, 10);
  assert.equal(out[2].chat_attachments?.[0].text, 'n'.repeat(8));
  assert.equal(out[0].chat_attachments?.[0].text, undefined);
  assert.equal(out[0].chat_attachments?.[0].text_dropped, true);
  assert.equal(out[0].chat_attachments?.[0].name, 'old.pdf');
  // Indata muteras inte.
  assert.equal(messages[0].chat_attachments[0].text, 'o'.repeat(8));
});

test('tolerant läsning av sparade bilagor', () => {
  assert.deepEqual(readChatMessageAttachments(null), []);
  assert.deepEqual(
    readChatMessageAttachments([{ name: 'a.pdf', mime: 'APPLICATION/PDF', kind: 'text', text: 'x', evil: 1 }, { kind: 'text' }]),
    [{ name: 'a.pdf', mime: 'application/pdf', kind: 'text', text: 'x' }]
  );
});

test('texten skickas inte till klienten', () => {
  const out = withoutChatAttachmentText([{ chat_attachments: [pdf('a.pdf', 'hemligt')] }]);
  assert.equal(out[0].chat_attachments?.[0].text, undefined);
  assert.equal(out[0].chat_attachments?.[0].name, 'a.pdf');
});
