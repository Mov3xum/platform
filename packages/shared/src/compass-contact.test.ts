import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_FIELD_KEYS,
  CONTACT_SECTION_DEFAULT,
  CONTACT_SECTION_NONE,
  cleanContactValues,
  contactSectionForModule,
  contactSectionFromForm,
  contactValueLabel,
  hasContactSection,
  legacyContactSection,
  legacyRequirementsFromSection,
  missingContactField,
  normalizeContactSection,
  visibleContactFields
} from './compass-contact';

test('legacy: chat/quiz visar namn + e-post, telefon/organisation bara när krävda; wizard inget avsnitt', () => {
  const chat = legacyContactSection('chat', { require_phone: true });
  assert.equal(chat.name, 'optional');
  assert.equal(chat.email, 'optional');
  assert.equal(chat.phone, 'required');
  assert.equal(chat.organization, 'hidden');
  assert.equal(chat.founder_gender, 'hidden');
  assert.equal(legacyContactSection('quiz', { require_email: true }).email, 'required');
  assert.deepEqual(legacyContactSection('wizard', { require_email: true }), CONTACT_SECTION_NONE);
  assert.equal(hasContactSection(legacyContactSection('wizard', {})), false);
});

test('normalizeContactSection: json-sträng, okända lägen ⇒ hidden, kön aldrig obligatoriskt, ogiltigt ⇒ fallback', () => {
  const cfg = normalizeContactSection(
    JSON.stringify({ name: 'required', founder_gender: 'required', kommun: 'weird', extra: 'required' }),
    CONTACT_SECTION_NONE
  );
  assert.equal(cfg.name, 'required');
  assert.equal(cfg.founder_gender, 'optional');
  assert.equal(cfg.kommun, 'hidden');
  assert.ok(!('extra' in cfg));
  assert.deepEqual(normalizeContactSection('{not json', CONTACT_SECTION_DEFAULT), CONTACT_SECTION_DEFAULT);
  assert.deepEqual(normalizeContactSection(null, CONTACT_SECTION_DEFAULT), CONTACT_SECTION_DEFAULT);
  assert.deepEqual(normalizeContactSection([1, 2], CONTACT_SECTION_DEFAULT), CONTACT_SECTION_DEFAULT);
});

test('contactSectionForModule: lagrad konfiguration vinner över legacy-booleaner', () => {
  const stored = contactSectionForModule({
    flow_type: 'wizard',
    require_email: true,
    contact_fields: { email: 'optional', kommun: 'required' }
  });
  assert.equal(stored.email, 'optional');
  assert.equal(stored.kommun, 'required');
  assert.equal(hasContactSection(stored), true);
  assert.deepEqual(visibleContactFields(stored), ['email', 'kommun']);
  const legacy = contactSectionForModule({ flow_type: 'wizard', require_email: true });
  assert.equal(hasContactSection(legacy), false);
});

test('contactSectionFromForm + legacyRequirementsFromSection', () => {
  const form: Record<string, string> = { contact_email: 'required', contact_phone: 'optional', contact_founder_gender: 'required' };
  const cfg = contactSectionFromForm((n) => form[n]);
  assert.equal(cfg.email, 'required');
  assert.equal(cfg.phone, 'optional');
  assert.equal(cfg.founder_gender, 'optional');
  assert.equal(cfg.team_members, 'hidden');
  assert.deepEqual(legacyRequirementsFromSection(cfg), {
    require_email: true,
    require_phone: false,
    require_organization: false
  });
});

test('cleanContactValues: dolda fält släpps, fasta val valideras, text saneras och cappas', () => {
  const cfg = { ...CONTACT_SECTION_DEFAULT, organization: 'optional' as const };
  const values = cleanContactValues(
    {
      name: '  Anna   Andersson ',
      email: 'anna@example.se',
      phone: '070-123 45 67',
      organization: 'x'.repeat(500),
      founder_gender: 'kvinna',
      kommun: 'gavle',
      referral_channel: 'nope',
      team_members: 'Bo Berg bo@example.se\r\nPersonnummer 19900101-1234\n',
      status: 'accepted',
      tenant: 'evil'
    },
    cfg
  );
  assert.equal(values.name, 'Anna Andersson');
  assert.equal(values.email, 'anna@example.se');
  assert.equal(values.organization?.length, 200);
  assert.equal(values.founder_gender, 'kvinna');
  assert.equal(values.kommun, 'gavle');
  assert.equal(values.referral_channel, undefined);
  assert.equal(values.team_members, 'Bo Berg bo@example.se\nPersonnummer [REDACTED]');
  assert.ok(!('status' in values));
  assert.ok(!('tenant' in values));
  // Dolt fält ignoreras även om det skickas.
  assert.equal(cleanContactValues({ founder_gender: 'man' }, CONTACT_SECTION_NONE).founder_gender, undefined);
  // Ogiltig e-post släpps.
  assert.equal(cleanContactValues({ email: 'inte-en-adress' }, cfg).email, undefined);
  assert.deepEqual(cleanContactValues(null, cfg), {});
});

test('missingContactField: första obligatoriska som saknas, i fast ordning', () => {
  const cfg = { ...CONTACT_SECTION_DEFAULT, kommun: 'required' as const };
  assert.equal(missingContactField({}, cfg), 'Namn på idéägaren krävs.');
  assert.equal(missingContactField({ name: 'A' }, cfg), 'E-post krävs.');
  assert.equal(missingContactField({ name: 'A', email: 'a@b.se' }, cfg), 'Kommuntillhörighet krävs.');
  assert.equal(missingContactField({ name: 'A', email: 'a@b.se', kommun: 'gavle' }, cfg), null);
  assert.equal(missingContactField({}, CONTACT_SECTION_NONE), null);
});

test('etiketter för fasta val och alla fält har metadata', () => {
  assert.equal(contactValueLabel('kommun', 'gavle'), 'Gävle');
  assert.equal(contactValueLabel('founder_gender', 'mixat_team'), 'Mixat team');
  assert.equal(contactValueLabel('referral_channel', 'event'), 'Event, föreläsning eller mässa');
  assert.equal(contactValueLabel('kommun', 'okand'), 'okand');
  assert.equal(contactValueLabel('name', ''), undefined);
  assert.equal(CONTACT_FIELD_KEYS.length, 8);
});
