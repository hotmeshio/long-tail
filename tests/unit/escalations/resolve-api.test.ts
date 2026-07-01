import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  getEscalation: vi.fn(),
  getEscalationBySignalKey: vi.fn(),
  resolveEscalation: vi.fn(),
  getEscalationRoles: vi.fn(),
  getEscalationScopeRows: vi.fn(),
  resolveEscalationsByIds: vi.fn(),
}));

vi.mock('../../../api/escalations/helpers', () => ({
  assertReadAccess: vi.fn(),
  assertWriteAccess: vi.fn(),
  getEscalationWriteScope: vi.fn(),
}));

vi.mock('../../../workers', () => ({
  createClient: vi.fn(),
}));

vi.mock('../../../services/task', () => ({
  getTask: vi.fn(),
}));

vi.mock('../../../services/escalation-strategy', () => ({
  escalationStrategyRegistry: { current: null },
}));

vi.mock('../../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(),
  formatEphemeralToken: vi.fn((id: string) => `eph:${id}`),
}));

vi.mock('../../../services/yaml-workflow/deployer', () => ({
  getEngine: vi.fn(),
}));

vi.mock('../../../modules/defaults', () => ({
  JOB_EXPIRE_SECS: 3600,
}));

import * as svc from '../../../services/escalation';
import { assertReadAccess, assertWriteAccess } from '../../../api/escalations/helpers';
import { createClient } from '../../../workers';
import { resolveEscalation, resolveBySignalKey, resolveByIds } from '../../../api/escalations/resolve';

const mockGet = vi.mocked(svc.getEscalation);
const mockGetBySignal = vi.mocked(svc.getEscalationBySignalKey);
const mockResolve = vi.mocked(svc.resolveEscalation);
const mockReadAccess = vi.mocked(assertReadAccess);
const mockWriteAccess = vi.mocked(assertWriteAccess);
const mockCreateClient = vi.mocked(createClient);

const AUTH = { userId: 'user-1' };

function makePending(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-1',
    status: 'pending',
    role: 'reviewer',
    workflow_id: 'wf-1',
    task_queue: 'long-tail-examples',
    workflow_type: 'reviewContent',
    signal_key: null,
    assigned_to: null,
    metadata: {},
    envelope: '{}',
    resolver_payload: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadAccess.mockResolvedValue(null);   // access allowed
  mockWriteAccess.mockResolvedValue(null);  // write allowed
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('resolveEscalation — input validation', () => {
  it('returns 400 when resolverPayload is missing', async () => {
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: null as any }, AUTH);
    expect(result.status).toBe(400);
  });

  it('returns 404 when escalation does not exist', async () => {
    mockGet.mockResolvedValue(null);
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(404);
  });

  it('returns 409 when escalation is cancelled', async () => {
    mockGet.mockResolvedValue(makePending({ status: 'cancelled' }));
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(409);
    expect(result.error).toContain('cancelled');
  });

  it('returns 409 when escalation is already resolved', async () => {
    mockGet.mockResolvedValue(makePending({ status: 'resolved' }));
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(409);
  });
});

// ── RBAC gates ────────────────────────────────────────────────────────────────

describe('resolveEscalation — RBAC', () => {
  it('returns 404 (non-disclosure) when caller cannot read the escalation', async () => {
    mockGet.mockResolvedValue(makePending());
    // assertReadAccess returns truthy = access denied
    mockReadAccess.mockResolvedValue({ status: 403, error: 'Not authorized' });
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(404);
    expect(result.error).toBe('Escalation not found');
  });

  it('returns write-scope error when caller can read but not write', async () => {
    mockGet.mockResolvedValue(makePending());
    mockReadAccess.mockResolvedValue(null);
    mockWriteAccess.mockResolvedValue({ status: 403, error: 'Write access denied' });
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(403);
  });
});

// ── Path 0: signal_key (atomic efficient resolve) ─────────────────────────────

describe('resolveEscalation — Path 0 (signal_key)', () => {
  it('calls resolveEscalation service when signal_key is set and metadata.signal_id is absent', async () => {
    const esc = makePending({ signal_key: 'ortho-design-wf-1', metadata: {} });
    mockGet.mockResolvedValue(esc);
    mockResolve.mockResolvedValue(esc);
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { approved: true } }, AUTH);
    expect(mockResolve).toHaveBeenCalledWith('esc-1', expect.any(Object), undefined);
    expect(result.status).toBe(200);
    expect((result.data as any).signaled).toBe(true);
  });

  it('returns 409 when resolveEscalation returns null (race lost)', async () => {
    const esc = makePending({ signal_key: 'ortho-design-wf-1', metadata: {} });
    mockGet.mockResolvedValue(esc);
    mockResolve.mockResolvedValue(null);
    const result = await resolveEscalation({ id: 'esc-1', resolverPayload: { approved: true } }, AUTH);
    expect(result.status).toBe(409);
  });

  it('does NOT call createClient for Path 0 (no separate signal needed)', async () => {
    const esc = makePending({ signal_key: 'ortho-design-wf-1', metadata: {} });
    mockGet.mockResolvedValue(esc);
    mockResolve.mockResolvedValue(esc);
    await resolveEscalation({ id: 'esc-1', resolverPayload: { approved: true } }, AUTH);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

// ── Path A: metadata.signal_id (conditionLT signal — legacy two-step) ─────────

describe('resolveEscalation — Path A (metadata.signal_id)', () => {
  it('calls handle.signal (not resolveEscalation) when metadata.signal_id is set', async () => {
    const mockSignal = vi.fn().mockResolvedValue(undefined);
    const mockHandle = { signal: mockSignal };
    const mockWorkflow = { getHandle: vi.fn().mockResolvedValue(mockHandle) };
    mockCreateClient.mockReturnValue({ workflow: mockWorkflow } as any);

    const esc = makePending({
      signal_key: null,
      metadata: { signal_id: 'sig-abc', order_id: 'ORD-1' },
    });
    mockGet.mockResolvedValue(esc);

    await resolveEscalation({ id: 'esc-1', resolverPayload: { approved: true } }, AUTH);

    expect(mockCreateClient).toHaveBeenCalled();
    expect(mockSignal).toHaveBeenCalledWith('sig-abc', expect.objectContaining({ $escalation_id: 'esc-1' }));
    // Path A does NOT call the resolveEscalation service — the workflow resolves the row itself
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('signal_key alone routes to Path 0 even when metadata is present but signal_id is absent', async () => {
    const esc = makePending({
      signal_key: 'ortho-print-wf-2',
      metadata: { order_id: 'ORD-1', stage: 'print' }, // no signal_id
    });
    mockGet.mockResolvedValue(esc);
    mockResolve.mockResolvedValue(esc);

    await resolveEscalation({ id: 'esc-1', resolverPayload: { filament: 'pla' } }, AUTH);

    expect(mockResolve).toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

// ── resolveBySignalKey ────────────────────────────────────────────────────────

describe('resolveBySignalKey', () => {
  it('returns 400 for missing signalKey', async () => {
    const result = await resolveBySignalKey({ signalKey: '', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(400);
  });

  it('returns 404 when no escalation found for the key', async () => {
    mockGetBySignal.mockResolvedValue(null);
    const result = await resolveBySignalKey({ signalKey: 'sig-xyz', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(404);
  });

  it('returns 409 when escalation is not pending', async () => {
    mockGetBySignal.mockResolvedValue(makePending({ status: 'resolved' }));
    const result = await resolveBySignalKey({ signalKey: 'sig-xyz', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(409);
  });

  it('returns 404 (non-disclosure) when caller lacks write access', async () => {
    mockGetBySignal.mockResolvedValue(makePending({ signal_key: 'sig-xyz' }));
    mockWriteAccess.mockResolvedValue({ status: 403, error: 'denied' });
    const result = await resolveBySignalKey({ signalKey: 'sig-xyz', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(404);
  });

  it('calls resolveEscalation service on success', async () => {
    const esc = makePending({ signal_key: 'sig-xyz' });
    mockGetBySignal.mockResolvedValue(esc);
    mockResolve.mockResolvedValue(esc);
    const result = await resolveBySignalKey({ signalKey: 'sig-xyz', resolverPayload: { ok: true } }, AUTH);
    expect(mockResolve).toHaveBeenCalledWith('esc-1', expect.any(Object), undefined);
    expect(result.status).toBe(200);
  });
});

// ── resolveByIds ──────────────────────────────────────────────────────────────

describe('resolveByIds', () => {
  it('returns 400 for empty ids array', async () => {
    const result = await resolveByIds({ ids: [], resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(400);
  });

  it('returns 400 for missing resolverPayload', async () => {
    const result = await resolveByIds({ ids: ['esc-1'], resolverPayload: null as any }, AUTH);
    expect(result.status).toBe(400);
  });
});
