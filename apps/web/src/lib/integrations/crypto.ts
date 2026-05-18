import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM symmetric encryption for integration credentials at
// rest in tenant_integrations.config. Key comes from
// MOVEXUM_INTEGRATION_KEY (32 bytes, base64). CLAUDE.md § 10.3
// (ISO 27001 A.8.24) — never log the key, never expose it.

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

function loadKey(): Buffer {
  const raw = process.env.MOVEXUM_INTEGRATION_KEY;
  if (!raw) {
    throw new Error('MOVEXUM_INTEGRATION_KEY saknas i miljövariablerna.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('MOVEXUM_INTEGRATION_KEY måste vara 32 bytes base64.');
  }
  return key;
}

export interface EncryptedBlob {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encryptCredentials(plaintext: Record<string, string>): EncryptedBlob {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ct.toString('base64')
  };
}

export function decryptCredentials(blob: EncryptedBlob): Record<string, string> {
  const key = loadKey();
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ct = Buffer.from(blob.ciphertext, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as Record<string, string>;
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.iv === 'string' &&
    typeof v.tag === 'string' &&
    typeof v.ciphertext === 'string'
  );
}
