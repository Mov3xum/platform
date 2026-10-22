import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMAIL_TEMPLATES,
  normalizeEmailBlocks,
  normalizeEmailCampaignContent,
  validateEmailCampaignForSend
} from './email-campaigns.ts';
import { renderCampaignEmail } from './email-render.ts';
import {
  absolutizeEmailAssetUrl,
  emailMediaIdFromPath,
  emailMediaPath,
  isEmailMediaPath,
  resolveEmailImageMime,
  validateEmailImageFile
} from './email-media.ts';

const ID = 'abc123def456ghi';

test('validateEmailImageFile: bara rasterbilder, ändelse som reserv, storlekstak', () => {
  assert.equal(validateEmailImageFile({ type: 'image/png', size: 1000 }).ok, true);
  assert.equal(validateEmailImageFile({ type: '', size: 1000, name: 'bild.JPG' }).ok, true);
  assert.equal(resolveEmailImageMime('application/octet-stream', 'x.webp'), 'image/webp');
  assert.equal(validateEmailImageFile({ type: 'image/svg+xml', size: 1000 }).ok, false);
  assert.equal(validateEmailImageFile({ type: 'application/pdf', size: 1000, name: 'a.pdf' }).ok, false);
  assert.equal(validateEmailImageFile({ type: 'image/png', size: 0 }).ok, false);
  assert.equal(validateEmailImageFile({ type: 'image/png', size: 9 * 1024 * 1024 }).ok, false);
});

test('emailMediaPath/isEmailMediaPath: bara appens egen bildsökväg godtas', () => {
  const p = emailMediaPath(ID, 'hero_ab12cd34ef.webp');
  assert.equal(p, `/api/public/e/bild/${ID}/hero_ab12cd34ef.webp`);
  assert.equal(isEmailMediaPath(p), true);
  assert.equal(emailMediaIdFromPath(p), ID);
  assert.equal(isEmailMediaPath('/api/public/e/bild/kort/x.png'), false);
  assert.equal(isEmailMediaPath(`/api/public/e/bild/${ID}/../x.png`), false);
  assert.equal(isEmailMediaPath(`/api/files/email_media/${ID}/x.png`), false);
  assert.equal(isEmailMediaPath('https://evil.se/api/public/e/bild/x'), false);
  assert.equal(isEmailMediaPath(`/api/public/e/bild/${ID}/x.png/extra`), false);
});

test('absolutizeEmailAssetUrl: relativ sökväg får utskickets bas, absoluta rörs inte', () => {
  assert.equal(absolutizeEmailAssetUrl('/api/public/e/bild/a/b.png', 'https://app.movexum.se/'), 'https://app.movexum.se/api/public/e/bild/a/b.png');
  assert.equal(absolutizeEmailAssetUrl('/x.png', null), '/x.png');
  assert.equal(absolutizeEmailAssetUrl('/x.png', 'inte-en-url'), '/x.png');
  assert.equal(absolutizeEmailAssetUrl('//evil.se/x.png', 'https://app.movexum.se'), '//evil.se/x.png');
  assert.equal(absolutizeEmailAssetUrl('https://cdn.se/x.png', 'https://app.movexum.se'), 'https://cdn.se/x.png');
});

test('bildblock: uppladdad sökväg behålls, främmande relativa sökvägar rensas', () => {
  const blocks = normalizeEmailBlocks([
    { type: 'image', url: emailMediaPath(ID, 'a.png'), alt: 'A' },
    { type: 'image', url: '/api/files/org_post_media/x/y.png', alt: 'B' },
    { type: 'image', url: 'https://movexum.se/c.png', alt: 'C' },
    { type: 'image', url: '', alt: 'tom' }
  ]);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].type === 'image' && blocks[0].url, emailMediaPath(ID, 'a.png'));
  assert.equal(blocks[1].type === 'image' && blocks[1].url, '');
  assert.equal(blocks[2].type === 'image' && blocks[2].url, 'https://movexum.se/c.png');
  assert.equal(blocks[3].type === 'image' && blocks[3].url, '');
});

test('ett tomt bildblock renderas inte och stoppar inte utskicket', () => {
  const content = normalizeEmailCampaignContent({
    title: 'Test',
    subject: 'Hej',
    preheader: '',
    blocks: [
      { type: 'image', url: '', alt: '' },
      { type: 'paragraph', text: 'Hej {{förnamn|du}}, en kort text om vad som händer i inkubatorn den här månaden.' }
    ],
    design: {},
    audience: { list: 'contacts', keys: ['c:abc'] },
    category: 'other',
    consent_mode: 'legitimate_interest'
  });
  assert.equal(validateEmailCampaignForSend(content, { hasEvent: false, recipients: 1 }).ok, true);
  const out = renderCampaignEmail({
    ...content,
    merge: {},
    links: {},
    reasonText: 'x',
    orgName: 'Movexum'
  });
  assert.equal(out.imageCount, 0);
  assert.equal(out.html.includes('<img'), false);
});

test('renderaren absolutiserar uppladdade bilder med assetBase', () => {
  const path = emailMediaPath(ID, 'hero_1234567890.webp');
  const base = {
    subject: 'Hej',
    preheader: '',
    blocks: normalizeEmailBlocks([{ type: 'image', url: path, alt: 'Hero' }, { type: 'paragraph', text: 'Text' }]),
    design: { accent: 'morkbla', layout: 'card', show_logo: true, personal_delivery: false } as const,
    merge: {},
    links: {},
    reasonText: 'x',
    orgName: 'Movexum'
  };
  const sent = renderCampaignEmail({ ...base, assetBase: 'https://app.movexum.se' });
  assert.equal(sent.imageCount, 1);
  assert.equal(sent.html.includes(`src="https://app.movexum.se${path}"`), true);
  const preview = renderCampaignEmail(base);
  assert.equal(preview.html.includes(`src="${path}"`), true);
});

test('mallarna Eventinbjudan, Save the date och Nyhetsbrev har en valfri bildplats — inte de textburna', () => {
  const withImage = EMAIL_TEMPLATES.filter((t) => t.blocks.some((b) => b.type === 'image')).map((t) => t.key).sort();
  assert.deepEqual(withImage, ['event_invite', 'newsletter', 'save_the_date']);
  for (const t of EMAIL_TEMPLATES) {
    for (const b of t.blocks) if (b.type === 'image') assert.equal(b.url, '');
  }
});
