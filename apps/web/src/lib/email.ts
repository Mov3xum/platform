import 'server-only';

const FROM_EMAIL = 'Movexum <noreply@movexum.se>';

function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('E-posttjänsten är inte konfigurerad. Kontakta administratören.');
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
<body style="margin:0;padding:0;background:#f2f2f2;font-family:system-ui,sans-serif;">
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
    console.error(`[email] Resend API error ${res.status}:`, body);
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
<body style="margin:0;padding:0;background:#f2f2f2;font-family:system-ui,sans-serif;">
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
              </table>
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
    console.error(`[email] Resend inflow notification error ${res.status}:`, body);
    throw new Error(`Kunde inte skicka inflödesnotis (fel ${res.status}).`);
  }
}
