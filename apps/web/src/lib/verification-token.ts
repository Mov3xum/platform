import 'server-only';
import { createHmac } from 'crypto';

const SECRET = process.env.VERIFICATION_SECRET ?? 'dev-secret-change-me-in-production';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 timmar

function hmac(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('base64url');
}

/**
 * Genererar ett HMAC-SHA256-signerat verifieringstoken för given userId.
 * Formatet är: base64url(payload).base64url(signature)
 */
export function generateVerificationToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + TTL_MS })
  ).toString('base64url');
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

/**
 * Verifierar och parsar ett verifieringstoken.
 * Returnerar { userId } om giltigt, annars null.
 */
export function parseVerificationToken(token: string): { userId: string } | null {
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex < 1) return null;

  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expected = hmac(payload);

  // Manuell constant-time-jämförelse (undviker timing-attacker)
  if (sig.length !== expected.length) return null;
  const sigBytes = Buffer.from(sig);
  const expBytes = Buffer.from(expected);
  let diff = 0;
  for (let i = 0; i < sigBytes.length; i++) {
    diff |= sigBytes[i] ^ expBytes[i];
  }
  if (diff !== 0) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId: string;
      exp: number;
    };
    if (!parsed.userId || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    return { userId: parsed.userId };
  } catch {
    return null;
  }
}
