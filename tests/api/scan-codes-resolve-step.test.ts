import { describe, it, expect, vi, beforeEach } from 'vitest';

// A resolve step carries its whole query into the atomic resolve: the claim
// state and, for a presented choice, the row the screen showed.
const mockResolveByMetadata = vi.fn();
vi.mock('../../api/escalations/metadata', () => ({
  resolveByMetadata: (...a: unknown[]) => mockResolveByMetadata(...a),
  claimByMetadata: vi.fn(),
  restrictScopeRoles: vi.fn(),
}));
vi.mock('../../api/escalations/accumulate', () => ({ accumulateItemByMetadata: vi.fn() }));
vi.mock('../../api/escalations/create', () => ({ createEscalation: vi.fn() }));
vi.mock('../../api/escalations/claim', () => ({ releaseEscalation: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({
  getEscalationReadScope: vi.fn(),
  getEscalationWriteScope: vi.fn().mockResolvedValue({ global: true, allRoles: [], selfRoles: [] }),
}));
vi.mock('../../api/scan-codes/locate', () => ({ locateForStep: vi.fn() }));

import { dispatchChoiceVerb, resolveStep } from '../../api/scan-codes/verbs';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const ctx = {
  scheme: { version: 14, target_facet: 'binCode' },
  rule: { name: 'Bin It', scheme_version: 14, category: '0' },
  parsed: { version: 14, category: '0', target: 'SHELF-7' },
  scannedAt: '2026-09-30T00:00:00.000Z',
  auth: { userId: 'associate-1' },
  stationAuth: { userId: 'station-1' },
  acting: true,
} as any;

const step: ScanStep = {
  query: { roles: ['binning-associate'], status: 'pending', availability: 'mine' },
  verb: 'resolve',
  params: { resolverPayload: { outcome: 'placed', binCode: '{scan.target}' } },
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveByMetadata.mockResolvedValue({ status: 200, data: { escalation: { id: 'esc-mine' } } });
});

describe('resolveStep', () => {
  it('passes the step claim state so mine resolves only the actor claim', async () => {
    const result = await resolveStep(step, ctx);
    const [input, auth] = mockResolveByMetadata.mock.calls[0];
    expect(input).toMatchObject({
      key: 'binCode', value: 'SHELF-7', availability: 'mine',
      restrictRoles: ['binning-associate'], resolverPayload: { outcome: 'placed', binCode: 'SHELF-7' },
    });
    expect(input.assertId).toBeUndefined();
    expect(auth.userId).toBe('associate-1');
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
  });

  it('a step without a claim state leaves the pick unchanged', async () => {
    await resolveStep({ ...step, query: { roles: ['binning-associate'] } } as any, ctx);
    expect(mockResolveByMetadata.mock.calls[0][0].availability).toBeUndefined();
  });

  it('no matching row falls through to the next step', async () => {
    mockResolveByMetadata.mockResolvedValue({ status: 404, error: 'none' });
    expect(await resolveStep(step, ctx)).toBeNull();
  });
});

describe('dispatchChoiceVerb resolve', () => {
  it('resolves the presented row by id under the step query', async () => {
    await dispatchChoiceVerb({ ...step, query: { ...step.query, availability: 'available' } } as any, ctx, { id: 'esc-shown' });
    expect(mockResolveByMetadata.mock.calls[0][0]).toMatchObject({ assertId: 'esc-shown', availability: 'available' });
  });

  it('a presented row that moved on is a conflict', async () => {
    mockResolveByMetadata.mockResolvedValue({ status: 404, error: 'none' });
    const result = await dispatchChoiceVerb(step, ctx, { id: 'esc-shown' });
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.CONFLICT);
  });
});
