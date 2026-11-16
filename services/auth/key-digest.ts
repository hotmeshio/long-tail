import * as crypto from 'crypto';

/**
 * SHA-256 of a high-entropy secret, in hex. API keys, service tokens, OAuth
 * codes and refresh tokens are looked up by this digest. Passwords use bcrypt.
 */
export function digestKey(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}
