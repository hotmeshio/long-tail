import { describe, it, expect } from 'vitest';

import { redactIdentityKeys } from '../../../services/user/redact';

describe('redactIdentityKeys', () => {
  it('drops identity keys from metadata and names them in identity_bound', () => {
    const user = { id: 'u1', metadata: { badge_id: 'TOKEN', shift: 'day' } };
    const read = redactIdentityKeys(user, ['badge_id']);
    expect(read.metadata).toEqual({ shift: 'day' });
    expect(read.identity_bound).toEqual(['badge_id']);
  });

  it('leaves the source record untouched', () => {
    const user = { metadata: { badge_id: 'TOKEN' } };
    redactIdentityKeys(user, ['badge_id']);
    expect(user.metadata.badge_id).toBe('TOKEN');
  });

  it('lists only the identity keys the user carries', () => {
    const read = redactIdentityKeys({ metadata: { pin: '1' } }, ['badge_id', 'pin']);
    expect(read.identity_bound).toEqual(['pin']);
  });

  it('handles null metadata', () => {
    const read = redactIdentityKeys({ metadata: null }, ['badge_id']);
    expect(read.metadata).toBeNull();
    expect(read.identity_bound).toEqual([]);
  });
});

describe('redactIdentityKeys with protection off', () => {
  it('keeps identity keys in metadata and still names them bound', async () => {
    const { setIdentityKeyProtection } = await import('../../../services/user/redact');
    setIdentityKeyProtection(false);
    try {
      const read = redactIdentityKeys({ metadata: { badge_id: 'TOKEN', shift: 'day' } }, ['badge_id']);
      expect(read.metadata).toEqual({ badge_id: 'TOKEN', shift: 'day' });
      expect(read.identity_bound).toEqual(['badge_id']);
    } finally {
      setIdentityKeyProtection(true);
    }
  });
});
