/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 54 — Marknadsverktyg → Kampanjer: e-postutskick som ersätter
// Mailchimp/Confetti, med spärrlista, webhook-händelser, preferenscenter och
// Confetti-funktionerna på svarssidan (gästfrågor, maxantal, väntelista,
// påminnelser, incheckning).
//
//   email_campaigns            ett utskick eller en sparad mall. Innehållet
//                              är typade block (json) som renderas server-side;
//                              mottagarurvalet är id-nycklar (json). Räknare
//                              per kampanj uppdateras av utskicket + webhooken.
//   email_campaign_recipients  en rad per mottagare: relationer (kontakt/
//                              användare/bolag), namn/organisation för visning,
//                              SHA-256 av adressen (webhook-matchning) — ALDRIG
//                              adressen själv — status, leverantörens
//                              meddelande-id, klick. Skrivs BARA av servern.
//   email_suppressions         spärrlistan: hashad adress + maskad visning +
//                              orsak (studs/klagomål/avregistrering/import/
//                              manuell). Unik per (tenant, email_hash).
//   email_events               PII-fri logg över leverantörens webhook-
//                              händelser (levererat/studs/klagomål) per
//                              kampanj och mottagare. Skrivs BARA av servern.
//
//   contacts += email_status (bounced/complained/unsubscribed), email_status_at,
//               email_opt_out (json: kategorier mottagaren stängt av),
//               newsletter_consent, newsletter_consent_at, newsletter_consent_source
//   event_signups += stage 'waitlist' (union), plus_ones, diet, custom_answer,
//                    checked_in_at, campaign (→ email_campaigns)
//   incubator_events += rsvp_settings (json), reminder_unanswered_sent_at,
//                       reminder_confirmed_sent_at
//
// RLS (§ 21.3): list/view staff/observer; createRules utan roll-check/join —
// kampanjer och spärrar pinnar tenant + skapare (§ 21.8); mottagarrader och
// händelser är server-only (createRule null). Autodate explicit (§ 28.5).
// Speglas i scripts/setup-via-api.mjs, asserteras i verify-baseline.mjs.
// Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

const STAGES = ['invited', 'declined', 'waitlist', 'signup', 'attended', 'meeting', 'application', 'admitted'];

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const eventsCol = app.findCollectionByNameOrId('incubator_events');
    const contactsCol = app.findCollectionByNameOrId('contacts');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const signupsCol = app.findCollectionByNameOrId('event_signups');
    let surveysCol = null;
    try {
      surveysCol = app.findCollectionByNameOrId('surveys');
    } catch (e) {
      surveysCol = null;
    }

    const rel = (name, col, opts = {}) => ({
      name,
      type: 'relation',
      required: false,
      collectionId: col.id,
      cascadeDelete: Boolean(opts.cascade),
      minSelect: 0,
      maxSelect: 1
    });
    const add = (col, f) => {
      if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
    };
    const ensureIndex = (col, name, sql) => {
      const indexes = Array.isArray(col.indexes) ? Array.from(col.indexes) : [];
      if (!indexes.some((i) => String(i).includes(name))) col.indexes = [...indexes, sql];
    };

    // ── email_campaigns ───────────────────────────────────────────────────
    let campaigns;
    try {
      campaigns = app.findCollectionByNameOrId('email_campaigns');
    } catch (e) {
      campaigns = new Collection({
        id: 'email_campaigns_collection',
        name: 'email_campaigns',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { ...rel('tenant', tenantsCol, { cascade: true }), required: true, minSelect: 1 },
          { name: 'title', type: 'text', required: true, min: 1, max: 120 },
          { name: 'subject', type: 'text', required: false, max: 150 },
          { name: 'preheader', type: 'text', required: false, max: 200 },
          // MÅSTE spegla EMAIL_CATEGORIES / EMAIL_CONSENT_MODES / EMAIL_CAMPAIGN_STATUSES
          // i packages/shared/src/email-campaigns.ts.
          { name: 'category', type: 'select', required: true, maxSelect: 1, values: ['events', 'newsletter', 'program', 'other'] },
          { name: 'consent_mode', type: 'select', required: true, maxSelect: 1, values: ['legitimate_interest', 'consent_only'] },
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'scheduled', 'sending', 'sent', 'cancelled'] },
          { name: 'template_key', type: 'text', required: false, max: 40 },
          { name: 'blocks', type: 'json', required: false, maxSize: 400000 },
          { name: 'design', type: 'json', required: false, maxSize: 2000 },
          { name: 'audience', type: 'json', required: false, maxSize: 600000 },
          { name: 'sender_name', type: 'text', required: false, max: 80 },
          rel('sender_user', usersCol),
          rel('event', eventsCol),
          // Kopplad utvärdering (§ 47) — "Tack och utvärdering"-mallen fyller
          // {{utvärdering.länk}} ur den. Utelämnas på en instans utan `surveys`.
          ...(surveysCol ? [rel('survey', surveysCol)] : []),
          { name: 'send_at', type: 'date', required: false },
          { name: 'sent_at', type: 'date', required: false },
          { name: 'send_base_url', type: 'text', required: false, max: 300 },
          { name: 'recipients_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'sent_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'failed_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'suppressed_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'bounced_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'complained_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'unsubscribed_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'clicked_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'link_clicks', type: 'json', required: false, maxSize: 60000 },
          { name: 'is_template', type: 'bool', required: false },
          { name: 'last_test_at', type: 'date', required: false },
          { name: 'last_error', type: 'text', required: false, max: 300 },
          rel('created_by', usersCol)
        ],
        indexes: [
          'CREATE INDEX idx_email_campaigns_tenant ON email_campaigns (tenant)',
          'CREATE INDEX idx_email_campaigns_tenant_status ON email_campaigns (tenant, status)',
          'CREATE INDEX idx_email_campaigns_send_at ON email_campaigns (send_at)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        createRule: `${ANY_AUTH} && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id`,
        updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
      });
      app.save(campaigns);
    }

    // ── email_campaign_recipients ─────────────────────────────────────────
    let recipients;
    try {
      recipients = app.findCollectionByNameOrId('email_campaign_recipients');
    } catch (e) {
      recipients = new Collection({
        id: 'email_campaign_recipients_collection',
        name: 'email_campaign_recipients',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { ...rel('tenant', tenantsCol, { cascade: true }), required: true, minSelect: 1 },
          { ...rel('campaign', campaigns, { cascade: true }), required: true, minSelect: 1 },
          rel('contact', contactsCol),
          rel('user', usersCol),
          rel('startup', startupsCol),
          rel('signup', signupsCol),
          { name: 'name', type: 'text', required: false, max: 200 },
          { name: 'organization', type: 'text', required: false, max: 200 },
          { name: 'email_hash', type: 'text', required: false, max: 64 },
          // MÅSTE spegla EMAIL_RECIPIENT_STATUSES.
          {
            name: 'status',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['pending', 'sent', 'failed', 'bounced', 'complained', 'unsubscribed', 'suppressed']
          },
          { name: 'sent_at', type: 'date', required: false },
          { name: 'provider_message_id', type: 'text', required: false, max: 100 },
          { name: 'click_count', type: 'number', required: false, min: 0, onlyInt: true },
          { name: 'first_clicked_at', type: 'date', required: false },
          { name: 'fail_reason', type: 'text', required: false, max: 300 }
        ],
        indexes: [
          'CREATE INDEX idx_email_recipients_campaign ON email_campaign_recipients (campaign)',
          'CREATE INDEX idx_email_recipients_tenant_hash ON email_campaign_recipients (tenant, email_hash)',
          'CREATE INDEX idx_email_recipients_message ON email_campaign_recipients (provider_message_id)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        createRule: null,
        updateRule: null,
        deleteRule: null
      });
      app.save(recipients);
    }

    // ── email_suppressions ────────────────────────────────────────────────
    try {
      app.findCollectionByNameOrId('email_suppressions');
    } catch (e) {
      const suppressions = new Collection({
        id: 'email_suppressions_collection',
        name: 'email_suppressions',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { ...rel('tenant', tenantsCol, { cascade: true }), required: true, minSelect: 1 },
          { name: 'email_hash', type: 'text', required: true, min: 64, max: 64 },
          { name: 'email_masked', type: 'text', required: false, max: 254 },
          // MÅSTE spegla EMAIL_SUPPRESSION_REASONS.
          { name: 'reason', type: 'select', required: true, maxSelect: 1, values: ['bounce', 'complaint', 'unsubscribe', 'import', 'manual'] },
          { name: 'source', type: 'text', required: false, max: 60 },
          { name: 'note', type: 'text', required: false, max: 200 },
          rel('created_by', usersCol)
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_email_suppressions_tenant_hash ON email_suppressions (tenant, email_hash)',
          'CREATE INDEX idx_email_suppressions_tenant_reason ON email_suppressions (tenant, reason)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        createRule: `${ANY_AUTH} && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id`,
        updateRule: null,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${LEAD}`
      });
      app.save(suppressions);
    }

    // ── email_events ──────────────────────────────────────────────────────
    try {
      app.findCollectionByNameOrId('email_events');
    } catch (e) {
      const events = new Collection({
        id: 'email_events_collection',
        name: 'email_events',
        type: 'base',
        fields: [
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          rel('tenant', tenantsCol, { cascade: true }),
          // MÅSTE spegla EMAIL_EVENT_TYPES.
          {
            name: 'type',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['delivered', 'bounced', 'complained', 'delivery_delayed', 'opened', 'clicked', 'unsubscribed']
          },
          rel('campaign', campaigns, { cascade: true }),
          rel('recipient', recipients, { cascade: true }),
          { name: 'provider_message_id', type: 'text', required: false, max: 100 },
          { name: 'detail', type: 'text', required: false, max: 200 },
          { name: 'at', type: 'date', required: false }
        ],
        indexes: [
          'CREATE INDEX idx_email_events_tenant_created ON email_events (tenant, created)',
          'CREATE INDEX idx_email_events_campaign ON email_events (campaign)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        createRule: null,
        updateRule: null,
        deleteRule: null
      });
      app.save(events);
    }

    // ── contacts ──────────────────────────────────────────────────────────
    add(contactsCol, { name: 'email_status', type: 'select', required: false, maxSelect: 1, values: ['bounced', 'complained', 'unsubscribed'] });
    add(contactsCol, { name: 'email_status_at', type: 'date', required: false });
    add(contactsCol, { name: 'email_opt_out', type: 'json', required: false, maxSize: 2000 });
    add(contactsCol, { name: 'newsletter_consent', type: 'bool', required: false });
    add(contactsCol, { name: 'newsletter_consent_at', type: 'date', required: false });
    add(contactsCol, { name: 'newsletter_consent_source', type: 'text', required: false, max: 40 });
    app.save(contactsCol);

    // ── event_signups ─────────────────────────────────────────────────────
    const stage = signupsCol.fields.getByName('stage');
    if (stage) {
      const values = Array.from(stage.values || []);
      const missing = STAGES.filter((v) => !values.includes(v));
      if (missing.length > 0) stage.values = [...values, ...missing];
    }
    add(signupsCol, { name: 'plus_ones', type: 'number', required: false, min: 0, max: 10, onlyInt: true });
    add(signupsCol, { name: 'diet', type: 'text', required: false, max: 300 });
    add(signupsCol, { name: 'custom_answer', type: 'text', required: false, max: 300 });
    add(signupsCol, { name: 'checked_in_at', type: 'date', required: false });
    add(signupsCol, rel('campaign', campaigns));
    app.save(signupsCol);

    // ── incubator_events ──────────────────────────────────────────────────
    add(eventsCol, { name: 'rsvp_settings', type: 'json', required: false, maxSize: 4000 });
    add(eventsCol, { name: 'reminder_unanswered_sent_at', type: 'date', required: false });
    add(eventsCol, { name: 'reminder_confirmed_sent_at', type: 'date', required: false });
    app.save(eventsCol);
    void ensureIndex;
  },
  (app) => {
    const drop = (colName, fields) => {
      try {
        const col = app.findCollectionByNameOrId(colName);
        for (const n of fields) {
          const f = col.fields.getByName(n);
          if (f) col.fields.removeById(f.id);
        }
        app.save(col);
      } catch (e) {
        /* ignore */
      }
    };
    drop('incubator_events', ['rsvp_settings', 'reminder_unanswered_sent_at', 'reminder_confirmed_sent_at']);
    drop('event_signups', ['plus_ones', 'diet', 'custom_answer', 'checked_in_at', 'campaign']);
    drop('contacts', ['email_status', 'email_status_at', 'email_opt_out', 'newsletter_consent', 'newsletter_consent_at', 'newsletter_consent_source']);
    for (const name of ['email_events', 'email_suppressions', 'email_campaign_recipients', 'email_campaigns']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* ignore */
      }
    }
  }
);
