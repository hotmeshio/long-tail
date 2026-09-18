import { describe, it, expect, vi, beforeEach } from 'vitest';

// The accumulate scan verb: item-locate mode joins the scanned item's own
// row to the container that shares its facet value (both rows in one
// statement); container-locate mode adds a templated item key to the row
// the scan found. Every outcome maps to the scan vocabulary.
vi.mock('../../api/escalations/accumulate', () => ({ accumulateItemByMetadata: vi.fn() }));
vi.mock('../../api/scan-codes/locate', () => ({ locateForStep: vi.fn() }));
vi.mock('../../api/escalations/metadata', () => ({
  claimByMetadata: vi.fn(), resolveByMetadata: vi.fn(), restrictScopeRoles: vi.fn(),
}));
vi.mock('../../api/escalations/create', () => ({ createEscalation: vi.fn() }));
vi.mock('../../api/escalations/claim', () => ({ releaseEscalation: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({ getEscalationReadScope: vi.fn(), getEscalationWriteScope: vi.fn() }));
vi.mock('../../services/escalation', () => ({}));

import { accumulateItemByMetadata } from '../../api/escalations/accumulate';
import { locateForStep } from '../../api/scan-codes/locate';
import { accumulateStep } from '../../api/scan-codes/verbs';
import { SCAN_OUTCOMES, SCAN_VERBS, type ScanStep } from '../../types';

const add = vi.mocked(accumulateItemByMetadata);
const locate = vi.mocked(locateForStep);

const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const member = { id: MEMBER_ID, metadata: { orderId: 'ORD-9', binKey: 'B-7' } } as any;
const ctx = {
  scheme: { version: 10, target_facet: 'orderId' },
  rule: { name: 'Bin it', notPrimed: {} },
  parsed: { version: 10, category: '3', target: 'ORD-9' },
  scannedAt: '2026-01-01T00:00:00Z',
  auth: { userId: 'u1' }, stationAuth: { userId: 'u1' }, acting: false,
} as any;

const itemLocate = (over: Partial<ScanStep> = {}): ScanStep => ({
  query: { roles: ['member'] },
  verb: SCAN_VERBS.ACCUMULATE,
  params: { accumulate: { containerFacet: 'binKey', containerRoles: ['bin'] }, resolverPayload: { scanned: '{scan.target}' } },
  ...over,
} as ScanStep);

beforeEach(() => {
  vi.clearAllMocks();
  locate.mockResolvedValue({ escalations: [member], total: 1 });
  add.mockResolvedValue({ status: 200, data: { outcome: 'accepted', count: 1, remaining: 3, escalationId: BIN_ID } });
});

describe('accumulateStep — item-locate mode', () => {
  it('joins the located item to the container sharing its facet, writing the item row as the reciprocal', async () => {
    const result = await accumulateStep(itemLocate(), ctx);
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    expect(result?.data?.verb).toBe(SCAN_VERBS.ACCUMULATE);
    expect(result?.data?.escalation).toMatchObject({ id: BIN_ID, count: 1 });
    const [request, auth] = add.mock.calls[0];
    expect(auth).toEqual(ctx.auth);
    expect(request).toMatchObject({
      key: 'binKey', value: 'B-7', itemKey: 'ORD-9',
      payload: { scanned: 'ORD-9' },
      restrictRoles: ['bin'],
      reciprocal: { id: MEMBER_ID },
    });
    expect(request.metadata).toMatchObject({ scanScheme: 10, scanCategory: '3', scanActionName: 'Bin it' });
  });

  it('skips the reciprocal when the step opts out', async () => {
    await accumulateStep(itemLocate({ params: { accumulate: { containerFacet: 'binKey', reciprocal: false } } }), ctx);
    expect(add.mock.calls[0][0].reciprocal).toBeUndefined();
  });

  it('falls through when no item row is located or it carries no container facet', async () => {
    locate.mockResolvedValue({ escalations: [], total: 0 });
    expect(await accumulateStep(itemLocate(), ctx)).toBeNull();
    locate.mockResolvedValue({ escalations: [{ id: MEMBER_ID, metadata: { orderId: 'ORD-9' } } as any], total: 1 });
    expect(await accumulateStep(itemLocate(), ctx)).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('accumulateStep — container-locate mode', () => {
  it('adds the templated item key to the container the scan found', async () => {
    const step = { query: { roles: ['bin'] }, verb: SCAN_VERBS.ACCUMULATE, params: { itemKey: 'inspection-{scan.category}' } } as ScanStep;
    await accumulateStep(step, ctx);
    expect(locate).not.toHaveBeenCalled();
    expect(add.mock.calls[0][0]).toMatchObject({ key: 'orderId', value: 'ORD-9', itemKey: 'inspection-3', restrictRoles: ['bin'] });
    expect(add.mock.calls[0][0].reciprocal).toBeUndefined();
  });
});

describe('accumulateStep — outcome mapping', () => {
  it('maps 404 to fall-through, 403 to forbidden, 409 to conflict', async () => {
    add.mockResolvedValue({ status: 404, error: 'nope' });
    expect(await accumulateStep(itemLocate(), ctx)).toBeNull();
    add.mockResolvedValue({ status: 403, error: 'no' });
    expect((await accumulateStep(itemLocate(), ctx))?.data?.outcome).toBe(SCAN_OUTCOMES.FORBIDDEN);
    add.mockResolvedValue({ status: 409, error: 'Item already held' });
    const conflict = await accumulateStep(itemLocate(), ctx);
    expect(conflict?.data?.outcome).toBe(SCAN_OUTCOMES.CONFLICT);
    expect(conflict?.data?.error).toMatch(/already held/);
  });

  it('passes other statuses through untouched', async () => {
    add.mockResolvedValue({ status: 422, error: 'invalid' });
    expect((await accumulateStep(itemLocate(), ctx))?.status).toBe(422);
  });
});
