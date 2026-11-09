import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSignedUrl = vi.fn();
vi.mock('../../../lib/storage', () => ({ getStorageBackend: () => ({ getSignedUrl }) }));

import { config } from '../../../modules/config';
import {
  claimSecondsLeft,
  fileContext,
  fileLinkSeconds,
  readFileRefs,
  signFileRefs,
} from '../../../services/escalation/file-links';

const NOW = Date.parse('2026-11-09T12:00:00Z');

beforeEach(() => {
  getSignedUrl.mockReset();
  getSignedUrl.mockImplementation(async (key: string, seconds: number) => `https://s3.test/${key}?ttl=${seconds}`);
});

describe('readFileRefs', () => {
  it('reads the reserved key from a string or object envelope', () => {
    const refs = [{ path: 'a.pdf', as: 'a' }];
    expect(readFileRefs(JSON.stringify({ files: refs }))).toEqual(refs);
    expect(readFileRefs({ files: refs })).toEqual(refs);
    expect(readFileRefs('not json')).toEqual([]);
    expect(readFileRefs(JSON.stringify({ files: 'x' }))).toEqual([]);
  });

  it('marks refs that never passed the creation check, and never drops the rest', () => {
    const out = readFileRefs({ files: [{ path: '../etc/passwd', as: 'x' }, { path: 'ok.pdf', as: 'ok' }, { path: 'b.pdf', as: 'ok' }] });
    expect(out[0]).toMatchObject({ error: expect.stringMatching(/storage key/) });
    expect(out[1]).toEqual({ path: 'ok.pdf', as: 'ok' });
    expect(out[2]).toMatchObject({ error: expect.stringMatching(/more than one/) });
  });
});

describe('fileLinkSeconds', () => {
  it('uses the default, the ask, and stretches to the claim, within bounds', () => {
    expect(fileLinkSeconds({}, 0)).toBe(config.LT_ESCALATION_FILE_URL_TTL_SECONDS);
    expect(fileLinkSeconds({ expiresIn: 300 }, 0)).toBe(300);
    expect(fileLinkSeconds({ expiresIn: 300 }, 1800)).toBe(1800);
    expect(fileLinkSeconds({ expiresIn: 1 }, 0)).toBe(config.LT_ESCALATION_FILE_URL_MIN_SECONDS);
    expect(fileLinkSeconds({ expiresIn: 10 ** 7 }, 0)).toBe(config.LT_ESCALATION_FILE_URL_MAX_SECONDS);
  });
});

describe('claimSecondsLeft', () => {
  it('counts only the reader\'s own live claim', () => {
    const until = new Date(NOW + 600_000);
    expect(claimSecondsLeft({ assigned_to: 'u1', assigned_until: until }, 'u1', NOW)).toBe(600);
    expect(claimSecondsLeft({ assigned_to: 'u2', assigned_until: until }, 'u1', NOW)).toBe(0);
    expect(claimSecondsLeft({ assigned_to: 'u1', assigned_until: new Date(NOW - 1) }, 'u1', NOW)).toBe(0);
    expect(claimSecondsLeft({ assigned_to: null, assigned_until: null }, 'u1', NOW)).toBe(0);
  });
});

describe('signFileRefs', () => {
  it('signs each ref for its window and reports when it lapses', async () => {
    const [link] = await signFileRefs([{ path: '/referrals/r 1.pdf', as: 'referral', expiresIn: 600 }], 0, NOW);
    expect(getSignedUrl).toHaveBeenCalledWith('referrals/r 1.pdf', 600);
    expect(link).toEqual({
      as: 'referral',
      path: 'referrals/r 1.pdf',
      name: 'r 1.pdf',
      contentType: 'application/pdf',
      url: 'https://s3.test/referrals/r 1.pdf?ttl=600',
      expiresAt: new Date(NOW + 600_000).toISOString(),
    });
  });

  it('honors a declared name and content type', async () => {
    const [link] = await signFileRefs([{ path: 'scans/8f2c', as: 'card', name: 'Card front', contentType: 'image/jpeg' }], 0, NOW);
    expect(link).toMatchObject({ name: 'Card front', contentType: 'image/jpeg' });
  });

  it('isolates a ref that cannot be signed, and never signs a malformed one', async () => {
    getSignedUrl.mockRejectedValueOnce(new Error('JWT_SECRET not configured'));
    const links = await signFileRefs(readFileRefs({ files: [
      { path: 'a.pdf', as: 'a' },
      { path: '../b.pdf', as: 'b' },
      { path: 'c.pdf', as: 'c' },
    ] }), 0, NOW);
    expect(links[0]).toMatchObject({ as: 'a', error: 'JWT_SECRET not configured' });
    expect(links[0].url).toBeUndefined();
    expect(links[1]).toMatchObject({ as: 'b', error: expect.stringMatching(/storage key/) });
    expect(links[2].url).toContain('c.pdf');
    expect(getSignedUrl).toHaveBeenCalledTimes(2);
  });
});

describe('fileContext', () => {
  it('describes valid refs without links, keyed by alias', () => {
    expect(fileContext({ files: [{ path: 'a/r.pdf', as: 'referral' }, { path: '..', as: 'bad' }] })).toEqual({
      referral: { as: 'referral', path: 'a/r.pdf', name: 'r.pdf', contentType: 'application/pdf' },
    });
    expect(fileContext({})).toBeNull();
  });
});
