import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation');
vi.mock('../../../services/escalation/signal-queue');
vi.mock('../../../workers');

import * as escalationService from '../../../services/escalation';
import * as signalQueue from '../../../services/escalation/signal-queue';
import { createClient } from '../../../workers';
import { resolveEscalation } from '../../../api/escalations/resolve';

const mockGetEscalation = vi.mocked(escalationService.getEscalation);
const mockResolveEscalation = vi.mocked(escalationService.resolveEscalation);
const mockSqGetBySignalKey = vi.mocked(signalQueue.sqGetBySignalKey);
const mockCreateClient = vi.mocked(createClient);

const SYSTEM_AUTH = { userId: 'system-uuid' };

function makeSqEscalation(overrides: Record<string, any> = {}) {
  return {
    id: 'esc-uuid',
    status: 'pending',
    workflow_id: 'wf-123',
    task_queue: 'sq-station-new',
    workflow_type: 'sqStationNew',
    metadata: { signal_id: 'sq-new-wf-123', signal_queue: true },
    ...overrides,
  } as any;
}

function makeSqEntry(overrides: Record<string, any> = {}) {
  return { id: 'sq-entry-uuid', signalKey: 'sq-new-wf-123', ...overrides } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveEscalation — Path F (signal_queue: true)', () => {
  it('returns 200 when signal queue entry found and resolve succeeds', async () => {
    mockGetEscalation.mockResolvedValue(makeSqEscalation());
    mockSqGetBySignalKey.mockResolvedValue(makeSqEntry());
    mockCreateClient.mockReturnValue({
      signalQueue: {
        resolve: vi.fn().mockResolvedValue({ ok: true }),
      },
    } as any);

    const result = await resolveEscalation(
      { id: 'esc-uuid', resolverPayload: { approved: true } },
      SYSTEM_AUTH,
    );

    expect(result.status).toBe(200);
    expect(result.data.signaled).toBe(true);
    expect(mockResolveEscalation).toHaveBeenCalledWith('esc-uuid', { approved: true });
  });

  it('returns 422 when signal_id missing from metadata', async () => {
    mockGetEscalation.mockResolvedValue(makeSqEscalation({
      metadata: { signal_queue: true },
    }));

    const result = await resolveEscalation(
      { id: 'esc-uuid', resolverPayload: { approved: true } },
      SYSTEM_AUTH,
    );

    expect(result.status).toBe(422);
  });

  it('returns 404 when signal queue entry not found by signal key', async () => {
    mockGetEscalation.mockResolvedValue(makeSqEscalation());
    mockSqGetBySignalKey.mockResolvedValue(null);

    const result = await resolveEscalation(
      { id: 'esc-uuid', resolverPayload: { approved: true } },
      SYSTEM_AUTH,
    );

    expect(result.status).toBe(404);
  });

  it('returns 207 partial when DB updated but signal delivery failed', async () => {
    mockGetEscalation.mockResolvedValue(makeSqEscalation());
    mockSqGetBySignalKey.mockResolvedValue(makeSqEntry());
    mockCreateClient.mockReturnValue({
      signalQueue: {
        resolve: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'signal-failed',
          signalKey: 'sq-new-wf-123',
        }),
      },
    } as any);

    const result = await resolveEscalation(
      { id: 'esc-uuid', resolverPayload: { approved: true } },
      SYSTEM_AUTH,
    );

    expect(result.status).toBe(207);
    expect(result.data.partial).toBe(true);
    expect(result.data.reason).toBe('signal-failed');
  });
});
