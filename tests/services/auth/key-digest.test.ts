import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';

import { digestKey } from '../../../services/auth/key-digest';
import { hashSecret } from '../../../services/auth/oauth-server';

describe('digestKey', () => {
  it('is the hex SHA-256 of the secret', () => {
    expect(digestKey('lt_bot_abc')).toBe(crypto.createHash('sha256').update('lt_bot_abc').digest('hex'));
    expect(digestKey('lt_bot_abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for one secret and distinct across secrets', () => {
    expect(digestKey('lt_bot_abc')).toBe(digestKey('lt_bot_abc'));
    expect(digestKey('lt_bot_abc')).not.toBe(digestKey('lt_bot_abd'));
  });

  it('is the digest the OAuth store uses', () => {
    expect(hashSecret('refresh-token')).toBe(digestKey('refresh-token'));
  });
});
