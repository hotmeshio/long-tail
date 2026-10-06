import { describe, it, expect, beforeAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { setEncryptionKey } from '../../../services/oauth/crypto';
import {
  consumeEphemeral,
  peekEphemeral,
  refundEphemeral,
  storeEphemeral,
} from '../../../services/iam/ephemeral';

// The acting-grant ledger against Postgres: peek never spends, consume
// spends once, a subject-scoped grant binds to its first ref, and a refund
// returns a spend whose act missed.

const SUBJECT_A = 'subject-a';
const SUBJECT_B = 'subject-b';

describe('ephemeral grant ledger', () => {
  beforeAll(async () => {
    setEncryptionKey('0'.repeat(64));
    await migrate();
  }, 30_000);

  it('peek reads a live grant without spending it', async () => {
    const token = await storeEphemeral('user-1', { maxUses: 1, ttlSeconds: 60 });
    expect(await peekEphemeral(token)).toEqual({ value: 'user-1', remaining: 1, bound: false });
    expect(await peekEphemeral(token)).toEqual({ value: 'user-1', remaining: 1, bound: false });
  });

  it('consume spends one use; an exhausted grant no longer peeks or consumes', async () => {
    const token = await storeEphemeral('user-1', { maxUses: 1, ttlSeconds: 60 });
    expect(await consumeEphemeral(token)).toEqual({ value: 'user-1', remaining: 0, bound: false });
    expect(await peekEphemeral(token)).toBeNull();
    expect(await consumeEphemeral(token)).toBeNull();
  });

  it('a TTL-bound grant reports unbounded remaining uses', async () => {
    const token = await storeEphemeral('user-1', { maxUses: 0, ttlSeconds: 60 });
    expect(await consumeEphemeral(token)).toMatchObject({ remaining: null });
  });

  it('a subject-scoped grant binds on its first spend and acts freely on that subject only', async () => {
    const token = await storeEphemeral('user-1', { maxUses: 1, ttlSeconds: 60, bindOnUse: true });
    expect(await consumeEphemeral(token, SUBJECT_A)).toEqual({ value: 'user-1', remaining: null, bound: true });
    expect(await consumeEphemeral(token, SUBJECT_A)).toMatchObject({ bound: true });
    expect(await consumeEphemeral(token, SUBJECT_A)).toMatchObject({ bound: true });
    expect(await consumeEphemeral(token, SUBJECT_B)).toBeNull();
    expect(await consumeEphemeral(token)).toBeNull();
  });

  it('a subject-scoped grant spent without a subject counts like any grant', async () => {
    const token = await storeEphemeral('user-1', { maxUses: 1, ttlSeconds: 60, bindOnUse: true });
    expect(await consumeEphemeral(token)).toEqual({ value: 'user-1', remaining: 0, bound: false });
    expect(await consumeEphemeral(token, SUBJECT_A)).toBeNull();
  });

  it('a refund returns the use and undoes the binding that spend made', async () => {
    const token = await storeEphemeral('user-1', { maxUses: 1, ttlSeconds: 60, bindOnUse: true });
    await consumeEphemeral(token, SUBJECT_A);
    await refundEphemeral(token, true);
    expect(await peekEphemeral(token)).toEqual({ value: 'user-1', remaining: 1, bound: false });
    expect(await consumeEphemeral(token, SUBJECT_B)).toMatchObject({ bound: true });
  });

  it('an expired grant neither peeks nor consumes', async () => {
    const token = await storeEphemeral('user-1', { maxUses: 0, ttlSeconds: 1 });
    await new Promise((r) => setTimeout(r, 1_100));
    expect(await peekEphemeral(token)).toBeNull();
    expect(await consumeEphemeral(token)).toBeNull();
  });
});
