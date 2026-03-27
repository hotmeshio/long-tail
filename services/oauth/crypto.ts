import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let _encryptionKey: Buffer | null = null;

/**
 * Set the encryption key for OAuth token storage.
 * Called during OAuth initialization from start.ts.
 */
export function setEncryptionKey(keyHex: string): void {
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== 32) {
    throw new Error(`OAUTH_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${buf.length}`);
  }
  _encryptionKey = buf;
}

/**
 * Get the encryption key. Reads from explicit config first,
 * then falls back to OAUTH_ENCRYPTION_KEY env var.
 */
export function getEncryptionKey(): Buffer {
  if (_encryptionKey) return _encryptionKey;
  const envKey = process.env.OAUTH_ENCRYPTION_KEY;
  if (envKey) {
    setEncryptionKey(envKey);
    return _encryptionKey!;
  }
  throw new Error('OAuth encryption key not configured. Set OAUTH_ENCRYPTION_KEY or pass auth.oauth.encryptionKey in startup config.');
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns base64-encoded string: iv:ciphertext:tag
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack as: iv + ciphertext + tag, then base64
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 */
export function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
