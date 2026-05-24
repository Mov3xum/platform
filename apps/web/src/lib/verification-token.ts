import 'server-only';
import { createHmac } from 'crypto';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns the VERIFICATION_SECRET env var.
 * Throws inside generateVerificationToken (can't create tokens without a secret).
 * parseVerificationToken swallows the error and returns null (graceful degradation).
 */
function getSecret(): string {
  const secret = process.env.VERIFICATION_SECRET;
  if (!secret) {
    throw new Error(
      'VERIFICATION_SECRET environment variable is not set. ' +
        'Set it to a random string of at least 32 characters.'
    );
  }
  return secret;
}

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Generates an HMAC-SHA256 signed verification token for the given userId.
 * Format: base64url(payload).base64url(signature)
 * Throws if VERIFICATION_SECRET is not set.
 */
export function generateVerificationToken(userId: string): string {
  const secret = getSecret();
  const payload = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + TTL_MS })
  ).toString('base64url');
  const sig = hmac(secret, payload);
  return `${payload}.${sig}`;
}

/**
 * Verifies and parses a verification token.
 * Returns { userId } if valid, otherwise null.
 * Returns null (instead of throwing) if VERIFICATION_SECRET is missing.
 */
export function parseVerificationToken(token: string): { userId: string } | null {
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  const dotIndex = token.lastIndexOf('.');
  if (dotIndex < 1) return null;

  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expected = hmac(secret, payload);

  // Manual constant-time comparison to prevent timing attacks
  if (sig.length !== expected.length) return null;
  const sigBytes = Buffer.from(sig, 'ascii');
  const expBytes = Buffer.from(expected, 'ascii');
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
