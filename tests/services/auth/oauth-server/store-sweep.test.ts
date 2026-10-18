import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
const info = vi.fn();
const warn = vi.fn();

vi.mock('../../../../lib/db', () => ({ getPool: () => ({ query }) }));
vi.mock('../../../../lib/logger', () => ({ loggerRegistry: { info, warn, error: vi.fn(), debug: vi.fn() } }));

const SWEEP_MS = 600 * 1000;
const STATEMENTS_PER_SWEEP = 4;

/** A fresh store module, so each test starts with no sweep on record. */
const loadStore = async () => {
  vi.resetModules();
  return import('../../../../services/auth/oauth-server/store');
};

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [{ grant_id: 'g', client_id: 'c' }], rowCount: 0 });
  info.mockReset();
  warn.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
});

afterEach(() => { vi.useRealTimers(); });

const prunes = () => query.mock.calls.filter(([sql]) => /^\s*DELETE/.test(sql));

describe('sweepOAuthServer', () => {
  it('prunes with the retention window, in days', async () => {
    const { sweepOAuthServer } = await loadStore();
    await sweepOAuthServer();
    expect(prunes()).toHaveLength(STATEMENTS_PER_SWEEP);
    for (const [, params] of prunes()) expect(params).toEqual(['7 days']);
  });

  it('runs at most once per sweep interval in a process', async () => {
    const { sweepOAuthServer } = await loadStore();
    await sweepOAuthServer();
    await sweepOAuthServer();
    vi.advanceTimersByTime(SWEEP_MS - 1);
    await sweepOAuthServer();
    expect(prunes()).toHaveLength(STATEMENTS_PER_SWEEP);
    vi.advanceTimersByTime(1);
    await sweepOAuthServer();
    expect(prunes()).toHaveLength(STATEMENTS_PER_SWEEP * 2);
  });

  it('logs the counts only when it removed something', async () => {
    const { sweepOAuthServer } = await loadStore();
    await sweepOAuthServer();
    expect(info).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SWEEP_MS);
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    await sweepOAuthServer();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"refreshTokens":3'));
  });

  it('logs a failed sweep and resolves, so the write that called it still succeeds', async () => {
    const { sweepOAuthServer } = await loadStore();
    query.mockRejectedValueOnce(new Error('connection lost'));
    await expect(sweepOAuthServer()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });
});

describe('OAuth writes sweep', () => {
  it('registering a client sweeps', async () => {
    const { registerClient } = await loadStore();
    await registerClient({ redirectUris: ['http://127.0.0.1/cb'] });
    await vi.waitFor(() => expect(prunes()).toHaveLength(STATEMENTS_PER_SWEEP));
  });

  it('issuing a code sweeps', async () => {
    const { issueAuthorizationCode } = await loadStore();
    await issueAuthorizationCode({
      userId: '00000000-0000-4000-8000-000000000001', clientId: 'c', policy: { preset: 'read_only' },
      scope: 'mcp:read', redirectUri: 'http://127.0.0.1/cb', codeChallenge: 'x', ttlSeconds: 60,
    });
    await vi.waitFor(() => expect(prunes()).toHaveLength(STATEMENTS_PER_SWEEP));
  });

  it('a refused rotation does not sweep', async () => {
    const { rotateRefreshToken } = await loadStore();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await rotateRefreshToken({ refreshToken: 'unknown', clientId: 'c', refreshTtlSeconds: 60 });
    expect(prunes()).toHaveLength(0);
  });
});
