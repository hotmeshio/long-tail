import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the workers module so no real DB connection is made
vi.mock('../../../workers', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '../../../workers';
import {
  sqList,
  sqGet,
  sqGetBySignalKey,
  sqClaim,
  sqClaimByMetadata,
  sqRelease,
  sqResolve,
  sqResolveByMetadata,
  sqReleaseExpired,
} from '../../../services/escalation/signal-queue';

const mockCreateClient = vi.mocked(createClient);

function makeEntry(overrides: Record<string, any> = {}) {
  return {
    id: 'sq-uuid-1',
    signalKey: 'station-done-wf-abc',
    status: 'pending' as const,
    role: 'operator',
    priority: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeClient(overrides: Record<string, any> = {}) {
  return {
    signalQueue: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue({ ok: true, entry: makeEntry() }),
      claimByMetadata: vi.fn().mockResolvedValue({ ok: true, entry: makeEntry() }),
      release: vi.fn().mockResolvedValue({ ok: true }),
      resolve: vi.fn().mockResolvedValue({ ok: true }),
      resolveByMetadata: vi.fn().mockResolvedValue({ ok: true }),
      releaseExpired: vi.fn().mockResolvedValue(3),
      ...overrides,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sqList', () => {
  it('delegates to client.signalQueue.list with params', async () => {
    const client = makeClient({ list: vi.fn().mockResolvedValue([makeEntry()]) });
    mockCreateClient.mockReturnValue(client);

    const result = await sqList({ role: 'operator', status: 'pending', limit: 10 });

    expect(client.signalQueue.list).toHaveBeenCalledWith({ role: 'operator', status: 'pending', limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].signalKey).toBe('station-done-wf-abc');
  });
});

describe('sqGet', () => {
  it('returns entry when found', async () => {
    const entry = makeEntry();
    const client = makeClient({ get: vi.fn().mockResolvedValue(entry) });
    mockCreateClient.mockReturnValue(client);

    const result = await sqGet('sq-uuid-1');

    expect(client.signalQueue.get).toHaveBeenCalledWith('sq-uuid-1');
    expect(result?.id).toBe('sq-uuid-1');
  });

  it('returns null when not found', async () => {
    const client = makeClient({ get: vi.fn().mockResolvedValue(null) });
    mockCreateClient.mockReturnValue(client);

    const result = await sqGet('nonexistent');

    expect(result).toBeNull();
  });
});

describe('sqGetBySignalKey', () => {
  it('returns matching entry when found in list', async () => {
    const entry = makeEntry({ signalKey: 'station-done-wf-xyz' });
    const client = makeClient({ list: vi.fn().mockResolvedValue([makeEntry(), entry]) });
    mockCreateClient.mockReturnValue(client);

    const result = await sqGetBySignalKey('station-done-wf-xyz');

    expect(result?.signalKey).toBe('station-done-wf-xyz');
    expect(result?.id).toBe('sq-uuid-1');
  });

  it('returns null when no entry matches the signal key', async () => {
    const client = makeClient({ list: vi.fn().mockResolvedValue([makeEntry()]) });
    mockCreateClient.mockReturnValue(client);

    const result = await sqGetBySignalKey('nonexistent-key');

    expect(result).toBeNull();
  });
});

describe('sqClaim', () => {
  it('returns ok result when claimed successfully', async () => {
    const client = makeClient();
    mockCreateClient.mockReturnValue(client);

    const result = await sqClaim({ id: 'sq-uuid-1', assignee: 'user-1', durationMinutes: 30 });

    expect(client.signalQueue.claim).toHaveBeenCalledWith({ id: 'sq-uuid-1', assignee: 'user-1', durationMinutes: 30 });
    expect(result.ok).toBe(true);
  });

  it('returns not-found result when signal does not exist', async () => {
    const client = makeClient({ claim: vi.fn().mockResolvedValue({ ok: false, reason: 'not-found' }) });
    mockCreateClient.mockReturnValue(client);

    const result = await sqClaim({ id: 'nonexistent' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('sqRelease', () => {
  it('passes id in params object to client', async () => {
    const client = makeClient();
    mockCreateClient.mockReturnValue(client);

    await sqRelease('sq-uuid-1');

    expect(client.signalQueue.release).toHaveBeenCalledWith({ id: 'sq-uuid-1' });
  });
});

describe('sqResolve', () => {
  it('returns ok when signal resolved and delivered', async () => {
    const client = makeClient();
    mockCreateClient.mockReturnValue(client);

    const result = await sqResolve({ id: 'sq-uuid-1', resolverPayload: { approved: true } });

    expect(result.ok).toBe(true);
  });

  it('returns signal-failed result when DB updated but delivery failed', async () => {
    const client = makeClient({
      resolve: vi.fn().mockResolvedValue({ ok: false, reason: 'signal-failed', signalKey: 'station-done-wf-abc' }),
    });
    mockCreateClient.mockReturnValue(client);

    const result = await sqResolve({ id: 'sq-uuid-1' });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'signal-failed') {
      expect(result.signalKey).toBe('station-done-wf-abc');
    }
  });
});

describe('sqResolveByMetadata', () => {
  it('returns not-found when no pending signal matches metadata', async () => {
    const client = makeClient({
      resolveByMetadata: vi.fn().mockResolvedValue({ ok: false, reason: 'not-found' }),
    });
    mockCreateClient.mockReturnValue(client);

    const result = await sqResolveByMetadata({ key: 'stationName', value: 'scan' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});

describe('sqReleaseExpired', () => {
  it('returns count of released claims', async () => {
    const client = makeClient();
    mockCreateClient.mockReturnValue(client);

    const count = await sqReleaseExpired();

    expect(count).toBe(3);
  });
});
