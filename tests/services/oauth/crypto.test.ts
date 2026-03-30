import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';

import { setEncryptionKey, encrypt, decrypt } from '../../../services/oauth/crypto';

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('OAuth crypto', () => {
  beforeAll(() => {
    setEncryptionKey(TEST_KEY);
  });

  it('should round-trip encrypt/decrypt', () => {
    const plaintext = 'ya29.a0AfH6SMB-secret-access-token';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('should produce different ciphertext for same input (random IV)', () => {
    const plaintext = 'test-token';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('should detect tampered ciphertext', () => {
    const ciphertext = encrypt('sensitive-data');
    const buf = Buffer.from(ciphertext, 'base64');
    buf[20] ^= 0xff; // flip a byte in the ciphertext
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('should reject invalid key length', () => {
    expect(() => setEncryptionKey('tooshort')).toThrow(/32 bytes/);
  });

  it('should handle empty string', () => {
    const ciphertext = encrypt('');
    expect(decrypt(ciphertext)).toBe('');
  });

  it('should handle unicode content', () => {
    const plaintext = 'token-with-emoji-🔑-and-日本語';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });
});
