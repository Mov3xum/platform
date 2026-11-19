import 'server-only';

/**
 * Auth-gate mot PocketBase (CLAUDE.md § 21.8, `hooks/auth_gate.pb.js`).
 *
 * När PB-resursen har `MOVEXUM_PB_AUTH_GATE_SECRET` släpper PB bara igenom
 * användarinloggning, OTP, lösenordsåterställning och verifiering som bär
 * headern nedan med samma värde. Webbappen skickar den på varje sådant anrop
 * så att lösenord inte kan prövas direkt mot PB:s publika adress (webbappens
 * egna gränser per IP/e-post gäller då alltid).
 *
 * Utrullning: sätt värdet på web-appen FÖRST (headern ignoreras av PB tills
 * PB har värdet), sedan på PB-resursen. Läses vid körning, aldrig vid bygget.
 */
export const PB_AUTH_GATE_HEADER = 'X-Movexum-Auth-Gate';

const ENV_KEY = 'MOVEXUM_PB_AUTH_GATE_SECRET';

function readSecret(): string {
  return (process.env[ENV_KEY] || '').trim();
}

/** Headers att skicka med PocketBase-SDK:ns `options.headers`. */
export function pbAuthGateHeaders(): Record<string, string> {
  const secret = readSecret();
  return secret ? { [PB_AUTH_GATE_HEADER]: secret } : {};
}

/** För /api/health — aldrig själva värdet. */
export function isPbAuthGateConfigured(): boolean {
  return readSecret().length > 0;
}
