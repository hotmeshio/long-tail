import { describe, it, expect, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';

import { createDigestAdopter, type DigestAdoptionStore } from '../../../services/auth/digest-adoption';
import { KEY_DIGEST_MISS_MEMO_MAX, KEY_DIGEST_MISS_MEMO_SECONDS } from '../../../modules/defaults';

const SECRET = 'stored-secret';
const HASH = bcrypt.hashSync(SECRET, 4);

function buildStore(rows: { id: string; hash: string }[] = [{ id: 'row-1', hash: HASH }]) {
  const store = {
    listWithoutDigest: vi.fn(async () => rows),
    setDigest: vi.fn(async () => {}),
  } satisfies DigestAdoptionStore;
  return store;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('createDigestAdopter', () => {
  it('gives the matching row its digest', async () => {
    const store = buildStore([{ id: 'other', hash: bcrypt.hashSync('other', 4) }, { id: 'row-1', hash: HASH }]);
    const adopt = createDigestAdopter(store);
    expect(await adopt(SECRET, 'digest-1')).toBe(true);
    expect(store.setDigest).toHaveBeenCalledExactlyOnceWith('row-1', 'digest-1');
  });

  it('answers false and writes nothing when no row matches', async () => {
    const store = buildStore();
    expect(await createDigestAdopter(store)('unknown', 'digest-x')).toBe(false);
    expect(store.setDigest).not.toHaveBeenCalled();
  });

  it('answers false with no rows and no bcrypt work', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    expect(await createDigestAdopter(buildStore([]))('unknown', 'digest-x')).toBe(false);
    expect(compare).not.toHaveBeenCalled();
  });

  it('shares one pass among concurrent presentations of one secret', async () => {
    const store = buildStore();
    const adopt = createDigestAdopter(store);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => adopt(SECRET, 'digest-1')));
    expect(results).toEqual([true, true, true, true, true]);
    expect(store.listWithoutDigest).toHaveBeenCalledTimes(1);
    expect(store.setDigest).toHaveBeenCalledTimes(1);
  });

  it('runs one pass at a time across secrets', async () => {
    const store = buildStore();
    let running = 0;
    let mostRunning = 0;
    store.listWithoutDigest.mockImplementation(async () => {
      mostRunning = Math.max(mostRunning, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return [];
    });
    const adopt = createDigestAdopter(store);
    await Promise.all(['a', 'b', 'c'].map((d) => adopt('unknown', d)));
    expect(store.listWithoutDigest).toHaveBeenCalledTimes(3);
    expect(mostRunning).toBe(1);
  });

  it('remembers an unmatched secret, so a repeat reads nothing', async () => {
    const store = buildStore();
    const adopt = createDigestAdopter(store);
    expect(await adopt('unknown', 'digest-x')).toBe(false);
    expect(await adopt('unknown', 'digest-x')).toBe(false);
    expect(store.listWithoutDigest).toHaveBeenCalledTimes(1);
  });

  it('looks again once the memory of an unmatched secret has lapsed', async () => {
    const store = buildStore();
    const adopt = createDigestAdopter(store);
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    await adopt('unknown', 'digest-x');
    now.mockReturnValue(KEY_DIGEST_MISS_MEMO_SECONDS * 1000 + 1);
    await adopt('unknown', 'digest-x');
    expect(store.listWithoutDigest).toHaveBeenCalledTimes(2);
  });

  it('keeps no memory of a matched secret', async () => {
    const store = buildStore();
    const adopt = createDigestAdopter(store);
    await adopt(SECRET, 'digest-1');
    await adopt(SECRET, 'digest-1');
    expect(store.listWithoutDigest).toHaveBeenCalledTimes(2);
  });

  it('holds at most the configured number of unmatched secrets', async () => {
    const store = buildStore([]);
    const adopt = createDigestAdopter(store);
    for (let i = 0; i <= KEY_DIGEST_MISS_MEMO_MAX; i++) await adopt('unknown', `digest-${i}`);
    store.listWithoutDigest.mockClear();
    await adopt('unknown', `digest-${KEY_DIGEST_MISS_MEMO_MAX}`);
    expect(store.listWithoutDigest).not.toHaveBeenCalled();
    await adopt('unknown', 'digest-0');
    expect(store.listWithoutDigest).toHaveBeenCalledTimes(1);
  });

  it('passes a storage failure to the caller and tries again next time', async () => {
    const store = buildStore();
    store.listWithoutDigest.mockRejectedValueOnce(new Error('connection lost'));
    const adopt = createDigestAdopter(store);
    await expect(adopt(SECRET, 'digest-1')).rejects.toThrow('connection lost');
    expect(await adopt(SECRET, 'digest-1')).toBe(true);
  });
});
