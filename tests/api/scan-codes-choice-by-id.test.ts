import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every presented choice writes the row the screen showed, even when the
// scanned code names several pending rows.
const claimByMetadata = vi.fn();
const resolveByMetadata = vi.fn();
const releaseEscalation = vi.fn();
const listEscalations = vi.fn();
const cancelEscalation = vi.fn();
const createEscalation = vi.fn();
vi.mock('../../api/escalations/metadata', () => ({
  claimByMetadata: (...a: unknown[]) => claimByMetadata(...a),
  resolveByMetadata: (...a: unknown[]) => resolveByMetadata(...a),
  restrictScopeRoles: vi.fn(() => null),
}));
vi.mock('../../api/escalations/create', () => ({ createEscalation: (...a: unknown[]) => createEscalation(...a) }));
vi.mock('../../api/escalations/claim', () => ({ releaseEscalation: (...a: unknown[]) => releaseEscalation(...a) }));
vi.mock('../../api/escalations/helpers', () => ({
  getEscalationReadScope: vi.fn().mockResolvedValue({ global: true, allRoles: [], selfRoles: [] }),
  getEscalationWriteScope: vi.fn().mockResolvedValue({ global: true, allRoles: [], selfRoles: [] }),
}));
vi.mock('../../services/escalation', () => ({
  listEscalations: (...a: unknown[]) => listEscalations(...a),
  cancelEscalation: (...a: unknown[]) => cancelEscalation(...a),
}));
vi.mock('../../api/scan-codes/grant', () => ({ spendGrant: vi.fn(async () => null) }));

import { dispatchChoiceVerb, claimStep } from '../../api/scan-codes/verbs';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const ctx = {
  scheme: { version: 14, target_facet: 'binCode' },
  rule: { name: 'Shelf', scheme_version: 14, category: '1' },
  parsed: { version: 14, category: '1', target: 'SHELF-7' },
  scannedAt: '2026-10-06T00:00:00.000Z',
  auth: { userId: 'associate-1' },
  stationAuth: { userId: 'station-1' },
  acting: false,
} as any;
const row = { id: '6f1c0d0e-5b8a-4c39-9a51-2f7f3b1d9e42', metadata: { binCode: 'SHELF-7' } };
const choice = (verb: string, params?: Record<string, any>): ScanStep =>
  ({ query: { roles: ['shelf'], subtypes: ['open'] }, verb, params } as any);

beforeEach(() => {
  vi.clearAllMocks();
  claimByMetadata.mockResolvedValue({ status: 200, data: { escalation: row } });
  resolveByMetadata.mockResolvedValue({ status: 200, data: { escalation: row } });
  releaseEscalation.mockResolvedValue({ status: 200, data: { escalation: row } });
  cancelEscalation.mockResolvedValue({ ...row, status: 'cancelled' });
  createEscalation.mockResolvedValue({ status: 201, data: { id: 'next-row' } });
});

describe('dispatchChoiceVerb writes the presented row by id', () => {
  it('claim and claim-show-detail assert the presented id', async () => {
    for (const verb of ['claim', 'claim-show-detail']) {
      claimByMetadata.mockClear();
      const result = await dispatchChoiceVerb(choice(verb, { durationMinutes: 30 }), ctx, row);
      expect(result.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
      expect(claimByMetadata.mock.calls[0][0]).toMatchObject({ key: 'binCode', value: 'SHELF-7', assertId: row.id });
    }
  });

  it('a claim the statement refuses (row moved on) is a conflict, never another row', async () => {
    claimByMetadata.mockResolvedValue({ status: 404, error: 'No pending escalation found for this metadata' });
    const result = await dispatchChoiceVerb(choice('claim'), ctx, row);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.CONFLICT);
    expect(claimByMetadata).toHaveBeenCalledTimes(1);
  });

  it('cancel locks the presented row, then cancels it', async () => {
    await dispatchChoiceVerb(choice('cancel'), ctx, row);
    expect(claimByMetadata.mock.calls[0][0].assertId).toBe(row.id);
    expect(cancelEscalation).toHaveBeenCalledWith(row.id);
  });

  it('release releases the presented row without searching by code', async () => {
    const result = await dispatchChoiceVerb(choice('release'), ctx, row);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    expect(releaseEscalation).toHaveBeenCalledWith({ id: row.id }, ctx.auth);
    expect(listEscalations).not.toHaveBeenCalled();
  });

  it('release of a row that is not your claim is a conflict', async () => {
    releaseEscalation.mockResolvedValue({ status: 409, error: 'Escalation not found or not claimed by you' });
    const result = await dispatchChoiceVerb(choice('release'), ctx, row);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.CONFLICT);
  });

  it('escalate closes the presented row before creating the next one', async () => {
    await dispatchChoiceVerb(choice('escalate', { targetRole: 'review', closeCurrent: 'resolve' }), ctx, row);
    expect(resolveByMetadata.mock.calls[0][0].assertId).toBe(row.id);
    await dispatchChoiceVerb(choice('escalate', { targetRole: 'review', closeCurrent: 'cancel' }), ctx, row);
    expect(claimByMetadata.mock.calls[0][0].assertId).toBe(row.id);
    expect(createEscalation).toHaveBeenCalledTimes(2);
  });

  it('resolve keeps asserting the presented id', async () => {
    await dispatchChoiceVerb(choice('resolve', { resolverPayload: {} }), ctx, row);
    expect(resolveByMetadata.mock.calls[0][0].assertId).toBe(row.id);
  });
});

describe('a claim step outside a present choice', () => {
  it('still claims by the scanned code', async () => {
    await claimStep(choice('claim'), ctx);
    expect(claimByMetadata.mock.calls[0][0].assertId).toBeUndefined();
  });
});
