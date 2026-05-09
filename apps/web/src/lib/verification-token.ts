import 'server-only';
import { createHmac } from 'crypto';

const SECRET = process.env.VERIFICATION_SECRET;
if (!SECRET) {
  // Fail fast at startup — never silently use a predictable default in any environment.
  throw new Error('VERIFICATION_SECRET environment variable is not set. Set it to a random string of at least 32 characters.');
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hmac(data: string): string {
  return createHmac('sha256', SECRET as string).update(data).digest('base64url');
}

/**
 * Generates an HMAC-SHA256 signed verification token for the given userId.
 * Format: base64url(payload).base64url(signature)
 */
export function generateVerificationToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + TTL_MS })
  ).toString('base64url');
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

/**
 * Verifies and parses a verification token.
 * Returns { userId } if valid, otherwise null.
 */
export function parseVerificationToken(token: string): { userId: string } | null {
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex < 1) return null;

  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expected = hmac(payload);

  // Manual constant-time comparison to prevent timing attacks
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
