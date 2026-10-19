import 'server-only';
import { describeResendError, listUnsubscribeHeaders, resolveReplyTo, resolveSender } from '@/lib/mail-sender';

// Avsändaren konfigureras i Coolify (`RESEND_FROM_EMAIL` m.fl., se
// lib/mail-sender.ts) och måste ligga på en domän som är verifierad i Resend.
const FROM_EMAIL = resolveSender(process.env, 'default');
const INVITE_FROM_EMAIL = resolveSender(process.env, 'invite');
const REPLY_TO = resolveReplyTo(process.env);

export const EMAIL_NOT_CONFIGURED_MESSAGE =
  'E-posttjänsten är inte konfigurerad (RESEND_API_KEY saknas på web-appen). Kontakta administratören.';

/**
 * Nyckeln som den står i Coolify — utan mellanslag/radbrytningar och omgivande
 * citattecken (ett klistrat `"re_…"` eller en avslutande radbrytning ger annars
 * 401 från Resend).
 */
function resendApiKey(): string {
  return (process.env.RESEND_API_KEY ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

/** Finns en Resend-nyckel? Utskicksflöden kontrollerar detta INNAN de skriver något. */
export function isEmailConfigured(): boolean {
  return Boolean(resendApiKey());
}

/** Ser nyckeln ut som en Resend-nyckel (`re_…`)? För driftdiagnosen — nyckeln lämnar aldrig servern. */
export function resendKeyLooksValid(): boolean {
  return /^re_[A-Za-z0-9_]{10,}$/.test(resendApiKey());
}

function getResendApiKey(): string {
  const key = resendApiKey();
  if (!key) {
    throw new Error(EMAIL_NOT_CONFIGURED_MESSAGE);
  }
  return key;
}

/**
 * Sends a verification email to a newly registered user via the Resend API.
 * Requires RESEND_API_KEY to be set in the environment.
 */
export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
  const apiKey = getResendApiKey();

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verifiera ditt konto – movexum</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:'Nunito Sans','Nunito Sans Variable',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:40px;max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-size:22px;font-weight:700;color:#121212;letter-spacing:-0.5px;">movexum</span>
            </td>
          </tr>
          <tr>
            <td>
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#121212;">
                Verifiera din e-postadress
              </h1>
              <p style="margin:0 0 24px;font-size:15px;color:#404040;line-height:1.6;">
                Klicka på knappen nedan för att aktivera ditt konto på Movexum
                inkubatorplattformen. Länken är giltig i 24 timmar.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#6138b5;border-radius:100px;">
                    <a
                      href="${verificationUrl}"
                      style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#f2f2f2;text-decoration:none;"
                    >
                      Verifiera konto
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#404040;">
                Fungerar inte knappen? Kopiera länken till webbläsaren:
              </p>
              <p style="margin:0;font-size:12px;color:#6138b5;word-break:break-all;">
                ${verificationUrl}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:32px;border-top:1px solid #e4dbfe;">
              <p style="margin:0;font-size:12px;color:#999999;text-align:center;">
                Om du inte skapade ett Movexum-konto kan du ignorera detta mail.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: 'Verifiera ditt konto på Movexum',
      html
    })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend API error ${res.status}: ${describeResendError(res.status, body, FROM_EMAIL)}`);
    throw new Error(`Kunde inte skicka verifieringsmail (fel ${res.status}). Försök igen.`);
  }
}

export interface InflowNotificationFields {
  /** Modulnamn (Startupkompassen-intaget som genererade inflödet). */
  moduleName: string;
  /** Etikett för flödestypen (AI-chatt / Formulär / Quiz). */
  flowLabel: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  ideaSummary?: string;
  ideaCategory?: string;
  /** Besökarens kontaktpreferens (läsbar etikett, migration 1700000125). */
  contactPreference?: string;
  /** AI-sammanställning av det inskickade (migration 1700000125). */
  aiSummary?: string;
  /** Direktlänk till leadet i /inflode/leads/<id> (om APP-URL är satt). */
  leadUrl?: string;
}

function row(label: string, value?: string): string {
  if (!value) return '';
  const safe = escapeHtml(value);
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#6138b5;font-weight:600;width:150px;vertical-align:top;">${escapeHtml(
      label
    )}</td>
    <td style="padding:6px 0;font-size:14px;color:#121212;vertical-align:top;">${safe}</td>
  </tr>`;
}

// Minimal HTML-escape (e-posten renderas i mottagarens klient — undvik att
// lead-inmatning bryter ut ur markupen). Speglar safe-html-policyn (§10.3).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Notifierar Movexums inflödesmail om ett nytt inflöde (lead) från
 * Startupkompassen. Skickas till en eller flera mottagare via Resend.
 * Kastar vid fel — anroparen kör best-effort och sväljer felet (ett inflöde
 * får aldrig fela för att notisen inte gick fram).
 */
export async function sendInflowNotification(
  recipients: string[],
  fields: InflowNotificationFields
): Promise<void> {
  const apiKey = getResendApiKey();
  const to = recipients.filter((r) => r && r.includes('@'));
  if (to.length === 0) return;

  const subjectName = fields.organization || fields.name || 'okänd avsändare';
  const subject = `Nytt inflöde: ${subjectName} – ${fields.moduleName}`;

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nytt inflöde – Startupkompassen</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:'Nunito Sans','Nunito Sans Variable',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:40px;max-width:560px;">
          <tr>
            <td style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:700;color:#121212;letter-spacing:-0.5px;">movexum</span>
              <div style="margin-top:4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6138b5;font-weight:600;">
                Startupkompassen
              </div>
            </td>
          </tr>
          <tr>
            <td>
              <h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#121212;">
                Nytt inflöde
              </h1>
              <p style="margin:0 0 24px;font-size:14px;color:#404040;line-height:1.6;">
                Ett nytt inflöde kom in via <strong>${escapeHtml(fields.moduleName)}</strong>
                (${escapeHtml(fields.flowLabel)}).
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4dbfe;">
                ${row('Namn', fields.name)}
                ${row('E-post', fields.email)}
                ${row('Telefon', fields.phone)}
                ${row('Organisation', fields.organization)}
                ${row('Kategori', fields.ideaCategory)}
                ${row('Idé / sammanfattning', fields.ideaSummary)}
                ${row('Kontaktpreferens', fields.contactPreference)}
                ${row('AI-sammanställning', fields.aiSummary)}
              </table>
              ${
                fields.aiSummary
                  ? `<p style="margin:12px 0 0;font-size:11px;color:#999999;">Sammanställningen är genererad av AI – verifiera innan delning.</p>`
                  : ''
              }
              ${
                fields.leadUrl
                  ? `<table cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td style="background:#002c40;border-radius:100px;">
                    <a href="${escapeHtml(fields.leadUrl)}"
                      style="display:inline-block;padding:13px 30px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Öppna leadet
                    </a>
                  </td>
                </tr>
              </table>`
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td style="padding-top:32px;border-top:1px solid #e4dbfe;">
              <p style="margin:24px 0 0;font-size:12px;color:#999999;">
                Automatisk notis från Movexum-plattformen. Följ upp leadet i
                Startupkompassens inflödesvy.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend inflow notification error ${res.status}: ${describeResendError(res.status, body, FROM_EMAIL)}`);
    throw new Error(`Kunde inte skicka inflödesnotis (fel ${res.status}).`);
  }
}

export interface ChatSummaryEmailFields {
  moduleName: string;
  /** Besökarsammanfattningen (ren text; radbrytningar bevaras). */
  summary: string;
  /** "Fråga: svar"-rader ur avslutssteget. */
  answers?: { question: string; answer: string }[];
  /** PDF-bilaga (samma dokument som nedladdningen). */
  pdf?: Buffer;
  brandName?: string;
}

/**
 * Skickar chattsammanfattningen (§ 23.10) till den adress BESÖKAREN själv
 * angav i avslutssteget. Ett engångsmejl — ingen prenumeration, ingen
 * notis till personalen. Kastar vid fel; anroparen är best-effort.
 */
export async function sendChatSummaryEmail(to: string, fields: ChatSummaryEmailFields): Promise<void> {
  const apiKey = getResendApiKey();
  const addr = (to || '').trim();
  if (!addr.includes('@')) return;
  const brand = fields.brandName || 'Movexum';
  const subject = `Din sammanfattning från ${brand} – ${fields.moduleName}`;
  const summaryHtml = escapeHtml(fields.summary).replace(/\n/g, '<br />');
  const answers = (fields.answers || []).filter((a) => a.question && a.answer);
  const html = `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:'Nunito Sans','Nunito Sans Variable',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:40px;max-width:560px;">
        <tr><td style="padding-bottom:24px;">
          <span style="font-size:22px;font-weight:700;color:#121212;letter-spacing:-0.5px;">movexum</span>
          <div style="margin-top:4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#002c40;font-weight:600;">${escapeHtml(fields.moduleName)}</div>
        </td></tr>
        <tr><td>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#121212;">Sammanfattning av ditt samtal</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#404040;line-height:1.7;">${summaryHtml}</p>
          ${
            answers.length > 0
              ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4dbfe;">${answers
                  .map((a) => row(a.question, a.answer))
                  .join('')}</table>`
              : ''
          }
          <p style="margin:20px 0 0;font-size:11px;color:#999999;">Sammanfattningen är genererad av AI utifrån det du själv berättade – verifiera innan du delar den vidare. Dina uppgifter hanteras inom EU.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const payload: Record<string, unknown> = { from: FROM_EMAIL, to: [addr], subject, html };
  if (fields.pdf) {
    payload.attachments = [{ filename: 'sammanfattning.pdf', content: fields.pdf.toString('base64') }];
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend chat summary error ${res.status}: ${describeResendError(res.status, body, FROM_EMAIL)}`);
    throw new Error(`Kunde inte skicka sammanfattningen (fel ${res.status}).`);
  }
}

// ── Studenter & talang (§ 54) ───────────────────────────────────────────────

export interface StudentEmailFields {
  subject: string;
  eyebrow?: string;
  heading: string;
  /** Ren text; radbrytningar bevaras. */
  intro: string;
  /** Extra stycken (ren text). */
  lines?: string[];
  cta?: { label: string; url: string };
  footer?: string;
}

/**
 * Ett brandat engångsmejl till en student (magisk länk, förslag från ett
 * bolag, besked om en matchning). Innehållet HTML-escapas; adressen loggas
 * aldrig. Studenten är en privatperson som själv registrerat sig — mejlet
 * säger alltid varför hen får det och hur profilen tas bort.
 */
export async function sendStudentEmail(to: string, f: StudentEmailFields): Promise<void> {
  const apiKey = getResendApiKey();
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const footer =
    f.footer ??
    'Du får det här mejlet eftersom du registrerat en studentprofil hos Movexum. Du kan när som helst pausa eller ta bort profilen på din sida.';
  const paragraphs = [f.intro, ...(f.lines ?? [])].filter(Boolean);
  const html = `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(f.subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:'Nunito Sans','Nunito Sans Variable',system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:40px;max-width:560px;">
        <tr><td style="padding-bottom:24px;"><span style="font-size:22px;font-weight:700;color:#121212;letter-spacing:-0.5px;">movexum</span></td></tr>
        <tr><td>
          ${f.eyebrow ? `<p style="margin:0 0 6px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b6b6b;">${esc(f.eyebrow)}</p>` : ''}
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#121212;">${esc(f.heading)}</h1>
          ${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#3f3f3f;white-space:pre-wrap;">${esc(p)}</p>`).join('')}
          ${f.cta ? `<a href="${esc(f.cta.url)}" style="display:inline-block;background:#002c40;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:999px;margin:8px 0 0;">${esc(f.cta.label)}</a>` : ''}
          <p style="margin:24px 0 0;font-size:11px;color:#8a8a8a;">${esc(footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [f.heading, ...paragraphs, f.cta ? `${f.cta.label}: ${f.cta.url}` : '', footer, 'Movexum'].filter(Boolean).join('\n\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject: f.subject,
      html,
      text,
      ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
      tags: [{ name: 'category', value: 'talent' }]
    })
  });
  if (!res.ok) {
    const reason = describeResendError(res.status, await res.text().catch(() => ''), FROM_EMAIL);
    console.error(`[email] Resend student email error ${res.status}: ${reason}`);
    throw new Error(reason);
  }
}
