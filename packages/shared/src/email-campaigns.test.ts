import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMAIL_TEMPLATES,
  applyEmailPreference,
  audienceHasRecipients,
  blocksNeedEvent,
  blocksNeedSignup,
  eventGroupMatches,
  checkEmailDeliverability,
  deliverabilityHealth,
  deliverabilityVerdict,
  emailBlockedReason,
  emailCampaignRates,
  emailEventTypeFromProvider,
  emailOptOutCategories,
  instantiateEmailTemplate,
  isHardBounce,
  isSafeEmailUrl,
  maskEmailAddress,
  normalizeEmailAddress,
  normalizeEmailAudience,
  normalizeEmailBlocks,
  normalizeEmailCampaignContent,
  normalizeEmailDesign,
  renderMergeFields,
  validateEmailCampaignForSend
} from './email-campaigns.ts';
import { renderCampaignEmail, inlineEmailMarkdown, plainEmailText } from './email-render.ts';
import { parseSuppressionImport } from './email-suppression-import.ts';
import {
  buildIcs,
  eventHasRoom,
  eventSeatsTaken,
  icsFilename,
  normalizeEventRsvpSettings,
  parseRsvpAnswers,
  reminderDue
} from './event-rsvp.ts';

// ── Block & innehåll ─────────────────────────────────────────────────────────

test('normalizeEmailBlocks: släpper okända typer, farliga länkar och cappar text', () => {
  const out = normalizeEmailBlocks([
    { id: 'a', type: 'heading', text: '  Hej\n  världen ' },
    { id: 'a', type: 'paragraph', text: 'Rad 1\r\nRad 2\u0000' },
    { type: 'button', label: 'Klicka', url: 'javascript:alert(1)' },
    { type: 'button', label: 'Ok', url: 'https://movexum.se/x', style: 'secondary' },
    { type: 'image', url: '{{event.namn}}', alt: 'x' },
    { type: 'image', url: 'https://movexum.se/a.png', alt: 'Bild', href: 'http://x.se' },
    { type: 'okänt' },
    'skräp',
    { type: 'spacer', size: 'xl' },
    { type: 'rsvp' }
  ]);
  assert.deepEqual(
    out.map((b) => b.type),
    ['heading', 'paragraph', 'button', 'button', 'image', 'image', 'spacer', 'rsvp']
  );
  assert.equal((out[0] as { text: string }).text, 'Hej världen');
  assert.equal((out[1] as { text: string }).text, 'Rad 1\nRad 2');
  assert.equal(out[1]!.id, 'a-2', 'dubblerat id görs unikt');
  assert.equal((out[2] as { url: string }).url, '', 'javascript: släpps');
  assert.equal((out[3] as { style: string }).style, 'secondary');
  assert.equal((out[4] as { url: string }).url, '', 'platshållare duger inte som bildadress');
  assert.equal((out[5] as { href: string }).href, 'http://x.se');
  assert.equal((out[6] as { size: string }).size, 'm');
  assert.ok(blocksNeedEvent(out));
});

test('isSafeEmailUrl', () => {
  assert.ok(isSafeEmailUrl('https://movexum.se/a?b=c'));
  assert.ok(isSafeEmailUrl('{{enkat}}'));
  assert.ok(!isSafeEmailUrl('javascript:x'));
  assert.ok(!isSafeEmailUrl('data:text/html,x'));
  assert.ok(!isSafeEmailUrl('https://x.se/<script>'));
  assert.ok(!isSafeEmailUrl(''));
});

test('normalizeEmailCampaignContent + validering för utskick', () => {
  const c = normalizeEmailCampaignContent({
    title: ' Frukost ',
    subject: 'Inbjudan',
    category: 'events',
    blocks: [{ type: 'paragraph', text: 'Hej' }, { type: 'rsvp' }],
    design: { accent: 'neon', layout: 'plain' },
    audience: { keys: ['c:abc', 'u:def', 'x:1', 'c:abc'], list: 'contacts' }
  });
  assert.equal(c.title, 'Frukost');
  assert.equal(c.consent_mode, 'legitimate_interest');
  assert.equal(c.design.accent, 'morkbla');
  assert.equal(c.design.layout, 'plain');
  assert.deepEqual(c.audience.keys, ['c:abc', 'u:def']);
  const noEvent = validateEmailCampaignForSend(c, { hasEvent: false, recipients: 3 });
  assert.ok(!noEvent.ok && /event/.test(noEvent.error));
  assert.ok(validateEmailCampaignForSend(c, { hasEvent: true, recipients: 3 }).ok);
  const none = validateEmailCampaignForSend(c, { hasEvent: true, recipients: 0 });
  assert.ok(!none.ok && /mottagare/.test(none.error));
  const newsletter = normalizeEmailCampaignContent({ title: 'N', category: 'newsletter' });
  assert.equal(newsletter.consent_mode, 'consent_only', 'nyhetsbrev kräver samtycke som default');
});

test('normalizeEmailDesign + audience tolererar skräp', () => {
  assert.deepEqual(normalizeEmailDesign(null), { accent: 'morkbla', layout: 'card', show_logo: true });
  assert.deepEqual(normalizeEmailDesign({ accent: 'gron', layout: 'plain', show_logo: false }), {
    accent: 'gron',
    layout: 'plain',
    show_logo: false
  });
  assert.deepEqual(normalizeEmailAudience('x'), { list: 'everyone', keys: [], event_group: null });
  assert.deepEqual(normalizeEmailAudience({ keys: ['c:a1', 'x:b', 'c:a1'], event_group: 'attended' }), {
    list: 'everyone',
    keys: ['c:a1'],
    event_group: 'attended'
  });
  assert.equal(normalizeEmailAudience({ event_group: 'alla' }).event_group, null, 'okänd grupp ⇒ ingen');
  assert.equal(audienceHasRecipients({ list: '', keys: [], event_group: 'unanswered' }), true);
  assert.equal(audienceHasRecipients({ list: '', keys: [], event_group: null }), false);
});

test('eventGroupMatches: deltagarlistans steg per mottagargrupp (§ 55.3)', () => {
  const invitedUnsent = { stage: 'invited', invite_sent_at: '' };
  const invitedSent = { stage: 'invited', invite_sent_at: '2026-10-01 10:00:00.000Z' };
  assert.equal(eventGroupMatches('unsent', invitedUnsent), true);
  assert.equal(eventGroupMatches('unsent', invitedSent), false);
  assert.equal(eventGroupMatches('unanswered', invitedSent), true);
  assert.equal(eventGroupMatches('unanswered', { stage: 'signup' }), false);
  assert.equal(eventGroupMatches('confirmed', { stage: 'signup' }), true);
  assert.equal(eventGroupMatches('confirmed', { stage: 'waitlist' }), false, 'väntelistan tar ingen plats');
  assert.equal(eventGroupMatches('confirmed', { stage: 'declined' }), false);
  assert.equal(eventGroupMatches('attended', { stage: 'signup' }), false, 'anmäld men inte närvarande');
  assert.equal(eventGroupMatches('attended', { stage: 'attended' }), true);
  assert.equal(eventGroupMatches('attended', { stage: 'admitted' }), true);
});

test('ticket-block: personlig biljettlänk + kalender, utelämnas utan länk', () => {
  const blocks = normalizeEmailBlocks([{ type: 'ticket' }, { type: 'paragraph', text: 'x' }]);
  assert.equal(blocksNeedSignup(blocks), true);
  assert.equal(blocksNeedEvent(blocks), true);
  const base = {
    subject: 'Vi ses',
    preheader: '',
    blocks,
    design: normalizeEmailDesign(null),
    merge: {},
    reasonText: 'r',
    orgName: 'Movexum'
  };
  const withTicket = renderCampaignEmail({ ...base, links: { ticket: 'https://app.test/e/svar?t=abc&klart=yes', calendar: 'https://app.test/api/public/e/kalender?e=k' } });
  assert.match(withTicket.html, /Visa din biljett/);
  assert.match(withTicket.html, /Lägg i kalendern/);
  assert.match(withTicket.text, /Visa din biljett: https:\/\/app\.test\/e\/svar\?t=abc/);
  assert.equal(withTicket.links.length, 0, 'personliga länkar spåras aldrig');
  const without = renderCampaignEmail({ ...base, links: {} });
  assert.doesNotMatch(without.html, /Visa din biljett/);
});

test('utvärderingslänken fylls i ur merge och knappen försvinner utan enkät', () => {
  const t = EMAIL_TEMPLATES.find((x) => x.key === 'thank_you')!;
  const blocks = instantiateEmailTemplate(t);
  const base = { subject: t.subject, preheader: '', blocks, design: t.design, links: {}, reasonText: 'r', orgName: 'Movexum' };
  const withSurvey = renderCampaignEmail({ ...base, merge: { event_name: 'Frukost', survey_url: 'https://app.test/u/abc?utm_source=event' } });
  assert.match(withSurvey.html, /Svara på utvärderingen/);
  assert.deepEqual(withSurvey.links, ['https://app.test/u/abc?utm_source=event']);
  const noSurvey = renderCampaignEmail({ ...base, merge: { event_name: 'Frukost' } });
  assert.doesNotMatch(noSurvey.html, /Svara på utvärderingen/, 'tom platshållare ger ingen trasig knapp');
  assert.equal(renderMergeFields('{{utvärdering.länk}}|{{utvardering.lank}}', { survey_url: 'https://x' }), 'https://x|https://x');
});

test('mallstrukturer: varje mall ger giltiga block och eventmallar bär eventblock', () => {
  for (const t of EMAIL_TEMPLATES) {
    const blocks = instantiateEmailTemplate(t);
    assert.ok(blocks.length > 0, t.key);
    assert.equal(new Set(blocks.map((b) => b.id)).size, blocks.length, `${t.key}: unika id:n`);
    assert.equal(blocksNeedEvent(blocks), t.needsEvent, t.key);
  }
  assert.equal(new Set(EMAIL_TEMPLATES.map((t) => t.key)).size, EMAIL_TEMPLATES.length);
});

// ── Platshållare ─────────────────────────────────────────────────────────────

test('renderMergeFields: fyller i, faller tillbaka och tar bort okända', () => {
  const data = { first_name: 'Anna', event_name: 'Frukost', organization: '' };
  assert.equal(renderMergeFields('Hej {{förnamn|du}} från {{organisation|er}}!', data), 'Hej Anna från er!');
  assert.equal(renderMergeFields('Hej {{fornamn}} — {{ event.namn }} {{okänt}}', data), 'Hej Anna — Frukost ');
  assert.equal(renderMergeFields('{{förnamn|du}}', {}), 'du');
});

// ── Rendering ────────────────────────────────────────────────────────────────

test('renderCampaignEmail: escapar, spårar innehållslänkar men aldrig avregistrering', () => {
  const tracked: string[] = [];
  const out = renderCampaignEmail({
    subject: 'Hej {{förnamn|du}} <b>',
    preheader: 'Förhand',
    blocks: normalizeEmailBlocks([
      { type: 'heading', text: 'Rubrik & mer' },
      { type: 'paragraph', text: 'Läs **detta** och [sidan](https://movexum.se/sida) <script>' },
      { type: 'button', label: 'Gå', url: 'https://movexum.se/go', style: 'primary' },
      { type: 'event_details' },
      { type: 'rsvp' },
      { type: 'signature', name: '{{avsändare}}', title: 'Movexum' }
    ]),
    design: { accent: 'morkbla', layout: 'card', show_logo: true },
    merge: { first_name: 'Anna', sender_name: 'Hampus', event_name: 'Frukost', event_when: '12 nov 08:00', event_location: 'Gävle' },
    links: {
      unsubscribe: 'https://app/e/avregistrera?k=1',
      preferences: 'https://app/e/installningar?k=1',
      rsvpYes: 'https://app/e/svar?t=abc&svar=yes',
      rsvpNo: 'https://app/e/svar?t=abc&svar=no',
      calendar: 'https://app/api/public/e/kalender?t=abc'
    },
    reasonText: 'Du får det här mejlet eftersom du finns i Movexums kontaktnät.',
    orgName: 'Movexum',
    trackLink: (url, i) => {
      tracked.push(url);
      return `https://app/api/public/e/klick?l=${i}`;
    }
  });
  assert.ok(out.html.includes('Rubrik &amp; mer'));
  assert.ok(out.html.includes('&lt;script&gt;'), 'HTML i text escapas');
  assert.ok(out.html.includes('<strong>detta</strong>'));
  assert.ok(out.html.includes('Hej Anna &lt;b&gt;'), 'ämnet fylls i och escapas i <title>');
  assert.deepEqual(tracked, ['https://movexum.se/sida', 'https://movexum.se/go'], 'bara innehållslänkar spåras');
  assert.deepEqual(out.links, tracked);
  assert.ok(out.html.includes('href="https://app/e/avregistrera?k=1"'), 'avregistrering spåras aldrig');
  assert.ok(out.html.includes('svar=yes') && out.html.includes('Jag kan inte'));
  assert.ok(out.html.includes('Lägg i kalendern'));
  assert.ok(out.html.includes('>movexum<'), 'wordmark på kort-layout');
  assert.ok(out.text.includes('Jag kommer: https://app/e/svar?t=abc&svar=yes'));
  assert.ok(out.text.includes('Avregistrera dig: https://app/e/avregistrera?k=1'));
  assert.ok(out.text.includes('Hampus'));
  assert.ok(!out.text.includes('**'));
  assert.equal(out.imageCount, 0);
  assert.ok(out.textLength > 20);
});

test('renderCampaignEmail: plain-layout saknar kort, wordmark och grå bakgrund', () => {
  const out = renderCampaignEmail({
    subject: 'x',
    preheader: '',
    blocks: normalizeEmailBlocks([{ type: 'paragraph', text: 'Hej' }, { type: 'rsvp' }]),
    design: { accent: 'gron', layout: 'plain', show_logo: true },
    merge: {},
    links: {},
    reasonText: 'Skäl.',
    orgName: 'Movexum'
  });
  assert.ok(!out.html.includes('>movexum<'));
  assert.ok(!out.html.includes('#f2f2f2'));
  assert.ok(!out.html.includes('Jag kommer'), 'rsvp utan länkar renderas inte');
});

test('inlineEmailMarkdown / plainEmailText', () => {
  assert.equal(inlineEmailMarkdown('a\nb', (u) => u), 'a<br />b');
  assert.equal(inlineEmailMarkdown('[x](javascript:1)', (u) => u), '[x](javascript:1)');
  assert.equal(plainEmailText('**fet** och [länk](https://a.se)'), 'fet och länk (https://a.se)');
});

// ── Leveransbarhet ───────────────────────────────────────────────────────────

test('checkEmailDeliverability flaggar de kända signalerna', () => {
  const base = {
    subject: 'Frukostträff i november',
    preheader: 'x',
    textLength: 400,
    imageCount: 0,
    links: ['https://movexum.se/a'],
    hasReplyTo: true,
    senderName: 'Hampus',
    layout: 'plain' as const,
    category: 'events' as const,
    consentMode: 'legitimate_interest' as const
  };
  assert.equal(deliverabilityVerdict(checkEmailDeliverability(base)), 'ok');
  const bad = checkEmailDeliverability({
    ...base,
    subject: 'GRATIS!!! KLICKA HÄR',
    textLength: 20,
    imageCount: 4,
    links: ['https://bit.ly/x', 'http://a.se', 'https://b.se', 'https://c.se', 'https://d.se', 'https://e.se', 'https://f.se', 'https://g.se', 'https://h.se'],
    hasReplyTo: false,
    senderName: '',
    layout: 'card',
    category: 'newsletter'
  });
  assert.equal(deliverabilityVerdict(bad), 'alert');
  const texts = bad.map((f) => f.text).join(' ');
  for (const needle of ['versaler', 'utropstecken', 'skräppost i ämnesraden', 'lite text', 'Länkförkortare', 'http (inte https)', 'svarsadress', 'samtycke']) {
    assert.ok(texts.includes(needle), needle);
  }
});

test('emailCampaignRates + deliverabilityHealth', () => {
  const r = emailCampaignRates({ sent_count: 1000, bounced_count: 30, complained_count: 2, clicked_count: 97, unsubscribed_count: 5 });
  assert.equal(r.delivered, 970);
  assert.equal(r.bounceRate, 0.03);
  assert.ok(Math.abs((r.complaintRate ?? 0) - 2 / 970) < 1e-9);
  assert.equal(deliverabilityHealth(r), 'warn');
  assert.equal(deliverabilityHealth(emailCampaignRates({ sent_count: 100, complained_count: 1 })), 'alert');
  assert.equal(deliverabilityHealth(emailCampaignRates({})), 'unknown');
  assert.equal(deliverabilityHealth(emailCampaignRates({ sent_count: 100 })), 'ok');
});

// ── Preferenser & spärr ──────────────────────────────────────────────────────

test('preferenser: events ↔ invite_opt_out, all stänger allt', () => {
  assert.deepEqual([...emailOptOutCategories({ invite_opt_out: true, email_opt_out: ['newsletter', 'x'] })], ['events', 'newsletter']);
  assert.equal(emailBlockedReason({ invite_opt_out: true }, 'events', 'legitimate_interest'), 'opt_out');
  assert.equal(emailBlockedReason({ invite_opt_out: true }, 'newsletter', 'legitimate_interest'), null);
  assert.equal(emailBlockedReason({ email_opt_out: ['all'] }, 'program', 'legitimate_interest'), 'opt_out');
  assert.equal(emailBlockedReason({ email_status: 'bounced' }, 'events', 'legitimate_interest'), 'status');
  assert.equal(emailBlockedReason({}, 'newsletter', 'consent_only'), 'no_consent');
  assert.equal(emailBlockedReason({ newsletter_consent: true }, 'newsletter', 'consent_only'), null);
  const off = applyEmailPreference({ invite_opt_out: true }, { category: 'newsletter', optOut: true });
  assert.deepEqual(off, { invite_opt_out: true, email_opt_out: ['newsletter'] });
  const all = applyEmailPreference(off, { category: 'all', optOut: true });
  assert.deepEqual(all, { invite_opt_out: true, email_opt_out: ['all'] });
  const back = applyEmailPreference(all, { category: 'events', optOut: false });
  assert.deepEqual(back, { invite_opt_out: false, email_opt_out: [] });
});

test('adresser: normalisering och maskning', () => {
  assert.equal(normalizeEmailAddress('  Anna.Svensson@Example.SE '), 'anna.svensson@example.se');
  assert.equal(normalizeEmailAddress('inte en adress'), null);
  assert.equal(maskEmailAddress('anna@example.se'), 'a***@example.se');
});

test('webhook-typer och studsklass', () => {
  assert.equal(emailEventTypeFromProvider('email.bounced'), 'bounced');
  assert.equal(emailEventTypeFromProvider('email.opened'), null);
  assert.ok(isHardBounce({ type: 'Permanent', subType: 'General' }));
  assert.ok(!isHardBounce({ type: 'Transient', subType: 'MailboxFull' }));
  assert.ok(isHardBounce(undefined));
});

// ── Mailchimp-spärrlista ─────────────────────────────────────────────────────

test('parseSuppressionImport känner igen Mailchimps unsubscribed- och cleaned-filer', () => {
  const unsub = parseSuppressionImport(
    ['Email Address', 'First Name', 'UNSUB_TIME', 'UNSUB_REASON'],
    [
      ['Anna@Example.se', 'Anna', '2024-03-12 09:41:07', 'Too many emails'],
      ['anna@example.se', 'Anna', '2024-03-12 09:41:07', ''],
      ['trasig', '', '', ''],
      ['bo@example.se', 'Bo', '', 'abuse']
    ]
  );
  assert.equal(unsub.detected.defaultReason, 'unsubscribe');
  assert.equal(unsub.rows.length, 2);
  assert.equal(unsub.duplicates, 1);
  assert.equal(unsub.invalid, 1);
  assert.equal(unsub.rows[0]!.email, 'anna@example.se');
  assert.equal(unsub.rows[0]!.at, '2024-03-12T09:41:07.000Z');
  assert.equal(unsub.rows[0]!.note, 'Too many emails');
  assert.equal(unsub.rows[1]!.reason, 'complaint');

  const cleaned = parseSuppressionImport(['Email Address', 'CLEANED_TIME'], [['x@y.se', '2024-01-01 00:00:00']]);
  assert.equal(cleaned.detected.defaultReason, 'bounce');
  assert.equal(cleaned.rows[0]!.reason, 'bounce');

  const none = parseSuppressionImport(['Namn'], [['x']]);
  assert.equal(none.rows.length, 0);
  assert.ok(none.warnings[0]!.includes('e-postadresser'));
});

// ── RSVP, kapacitet, kalender, påminnelser ───────────────────────────────────

test('rsvp-inställningar normaliseras och svar cappas till det som frågas', () => {
  const s = normalizeEventRsvpSettings({ plus_ones_max: '99', ask_diet: 'on', custom_question: ' Fråga ', capacity: '40', remind_unanswered_days: 3 });
  assert.equal(s.plus_ones_max, 10);
  assert.ok(s.ask_diet);
  assert.equal(s.custom_question, 'Fråga');
  assert.equal(s.capacity, 40);
  assert.equal(s.waitlist, true);
  const a = parseRsvpAnswers(s, { plus_ones: '3', diet: ' Vegetarian\n', custom_answer: 'Svar' });
  assert.deepEqual(a, { plus_ones: 3, diet: 'Vegetarian', custom_answer: 'Svar' });
  const none = parseRsvpAnswers(normalizeEventRsvpSettings(null), { plus_ones: '3', diet: 'x', custom_answer: 'y' });
  assert.deepEqual(none, { plus_ones: 0, diet: '', custom_answer: '' }, 'frågor som inte ställs sparas inte');
});

test('kapacitet räknar platser inkl. medföljande', () => {
  const rows = [
    { stage: 'signup', plus_ones: 2 },
    { stage: 'attended', plus_ones: 0 },
    { stage: 'invited', plus_ones: 5 },
    { stage: 'waitlist', plus_ones: 1 },
    { stage: 'declined' }
  ];
  assert.equal(eventSeatsTaken(rows), 4);
  const s = normalizeEventRsvpSettings({ capacity: 5 });
  assert.ok(eventHasRoom(s, 4, 1));
  assert.ok(!eventHasRoom(s, 4, 2));
  assert.ok(eventHasRoom(s, 5, 2, 3), 'den som redan tar 3 platser kan byta till 2');
  assert.ok(eventHasRoom(normalizeEventRsvpSettings({}), 1000, 50));
});

test('buildIcs: giltig fil med escapade fält och vikta rader', () => {
  const ics = buildIcs({
    uid: 'ev1@movexum',
    title: 'Frukost; nätverk, kaffe',
    description: 'Rad 1\nRad 2',
    location: 'Gävle',
    starts_at: '2026-11-12T07:00:00.000Z',
    ends_at: '2026-11-12T09:00:00.000Z',
    url: 'https://app.movexum.se/e/svar?t=x',
    organizerEmail: 'event@movexum.se',
    now: new Date('2026-10-01T00:00:00Z')
  });
  assert.ok(ics);
  assert.ok(ics!.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics!.includes('DTSTART:20261112T070000Z'));
  assert.ok(ics!.includes('DTEND:20261112T090000Z'));
  assert.ok(ics!.includes('SUMMARY:Frukost\\; nätverk\\, kaffe'));
  assert.ok(ics!.includes('DESCRIPTION:Rad 1\\nRad 2'));
  assert.ok(ics!.includes('ORGANIZER;CN=Movexum:mailto:event@movexum.se'));
  assert.ok(ics!.split('\r\n').every((l) => l.length <= 75));
  assert.equal(buildIcs({ uid: 'x', title: 'x', starts_at: 'nonsens' }), null);
  assert.equal(icsFilename('Frukostträff: Finansiering 2027'), 'Frukosttraff-Finansiering-2027.ics');
});

test('reminderDue: fönstret öppnar N dygn före och stänger vid start', () => {
  const settings = normalizeEventRsvpSettings({ remind_unanswered_days: 2 });
  const starts_at = '2026-11-12T07:00:00.000Z';
  const due = (now: string, sentAt: string | null = null) =>
    reminderDue({ settings, kind: 'unanswered', starts_at, sentAt, now: new Date(now) });
  assert.ok(!due('2026-11-09T07:00:00Z'));
  assert.ok(due('2026-11-10T07:00:00Z'));
  assert.ok(due('2026-11-12T06:59:00Z'));
  assert.ok(!due('2026-11-12T07:00:00Z'));
  assert.ok(!due('2026-11-11T07:00:00Z', '2026-11-10T07:00:00Z'));
  assert.ok(!reminderDue({ settings, kind: 'confirmed', starts_at, sentAt: null, now: new Date('2026-11-11T07:00:00Z') }), 'av = aldrig');
});

// ── Leveransstatus från Resend (§ 55.4) ─────────────────────────────────────

test('deliveryStatusFromProviderEvent: tolkar Resends last_event, okänt ⇒ null', async () => {
  const { deliveryStatusFromProviderEvent, isFinalDeliveryStatus } = await import('./email-campaigns.ts');
  assert.equal(deliveryStatusFromProviderEvent('delivered'), 'delivered');
  assert.equal(deliveryStatusFromProviderEvent('email.delivered'), 'delivered');
  assert.equal(deliveryStatusFromProviderEvent('opened'), 'delivered');
  assert.equal(deliveryStatusFromProviderEvent('clicked'), 'delivered');
  assert.equal(deliveryStatusFromProviderEvent('bounced'), 'bounced');
  assert.equal(deliveryStatusFromProviderEvent('bounce'), 'bounced');
  assert.equal(deliveryStatusFromProviderEvent('complaint'), 'complained');
  assert.equal(deliveryStatusFromProviderEvent('delivery_delayed'), 'delivery_delayed');
  assert.equal(deliveryStatusFromProviderEvent('queued'), 'queued');
  assert.equal(deliveryStatusFromProviderEvent('sent'), 'sent');
  assert.equal(deliveryStatusFromProviderEvent('cancelled'), 'canceled');
  assert.equal(deliveryStatusFromProviderEvent('something_else'), null);
  assert.equal(deliveryStatusFromProviderEvent(undefined), null);
  assert.equal(deliveryStatusFromProviderEvent(42), null);
  assert.equal(isFinalDeliveryStatus('delivered'), true);
  assert.equal(isFinalDeliveryStatus('bounced'), true);
  assert.equal(isFinalDeliveryStatus('sent'), false);
  assert.equal(isFinalDeliveryStatus('queued'), false);
  assert.equal(isFinalDeliveryStatus(null), false);
});

test('summarizeDeliveryStatuses: räknar bara skickade rader, okontrollerade för sig', async () => {
  const { summarizeDeliveryStatuses } = await import('./email-campaigns.ts');
  const s = summarizeDeliveryStatuses([
    { status: 'sent', delivery_status: 'delivered' },
    { status: 'sent', delivery_status: 'opened' },
    { status: 'sent', delivery_status: 'sent' },
    { status: 'sent', delivery_status: '' },
    { status: 'sent' },
    { status: 'bounced', delivery_status: 'bounced' },
    { status: 'sent', delivery_status: 'failed' },
    { status: 'suppressed', delivery_status: '' },
    { status: 'failed' }
  ]);
  assert.deepEqual(s, { checked: 5, delivered: 2, pending: 1, bounced: 1, complained: 0, failed: 1, unchecked: 2 });
});
