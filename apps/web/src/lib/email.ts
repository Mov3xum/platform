import 'server-only';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Movexum <noreply@movexum.se>';

/**
 * Skickar ett verifieringsmail till den nyregistrerade användaren via Resend API.
 * Kräver att RESEND_API_KEY är satt i miljön.
 */
export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error('[email] RESEND_API_KEY saknas — verifieringsmail kan inte skickas');
    throw new Error('E-posttjänsten är inte konfigurerad. Kontakta administratören.');
  }

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
      Authorization: `Bearer ${RESEND_API_KEY}`
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
    console.error(`[email] Resend API-fel ${res.status}:`, body);
    throw new Error(`Kunde inte skicka verifieringsmail (fel ${res.status}). Försök igen.`);
  }
}
