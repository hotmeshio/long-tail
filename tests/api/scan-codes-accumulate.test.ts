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
vi.mock('../../services/escalation', () => ({ listEscalations: vi.fn() }));

import { accumulateItemByMetadata } from '../../api/escalations/accumulate';
import { listEscalations } from '../../services/escalation';
import { locateForStep } from '../../api/scan-codes/locate';
import { accumulateStep } from '../../api/scan-codes/verbs';
import { SCAN_OUTCOMES, SCAN_VERBS, type ScanStep } from '../../types';

const add = vi.mocked(accumulateItemByMetadata);
const listClaims = vi.mocked(listEscalations);
const locate = vi.mocked(locateForStep);

const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const member = { id: MEMBER_ID, metadata: { orderId: 'ORD-9', binKey: 'B-7' } } as any;
const ctx = {
  scheme: { version: 10, target_facet: 'orderId' },
  rule: { name: 'Bin it', notPrimed: {}, fallback: { markdown: 'Scan again' } },
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

describe('accumulateStep — templates from the claim and the located item', () => {
  const liveClaim = (metadata: Record<string, unknown>) => ({
    id: 'c-1', metadata, assigned_to: 'u1', assigned_until: new Date(Date.now() + 60_000),
  }) as any;

  it('reads {item.<facet>} from the located row in item mode', async () => {
    await accumulateStep(itemLocate({
      params: { accumulate: { containerFacet: 'binKey' }, resolverPayload: { bin: '{item.binKey}', order: '{scan.target}' } },
    }), ctx);
    expect(add.mock.calls[0][0].payload).toEqual({ bin: 'B-7', order: 'ORD-9' });
    expect(listClaims).not.toHaveBeenCalled();
  });

  it('reads {claim.<facet>} from the actor\'s single live claim, one query, only when mentioned', async () => {
    listClaims.mockResolvedValue({ escalations: [liveClaim({ orderId: 'ORD-42' })], total: 1 });
    const step = { query: { roles: ['bin'] }, verb: SCAN_VERBS.ACCUMULATE, params: { itemKey: '{claim.orderId}' } } as ScanStep;
    await accumulateStep(step, ctx);
    expect(listClaims).toHaveBeenCalledTimes(1);
    expect(listClaims.mock.calls[0][0]).toMatchObject({ assigned_to: 'u1', status: 'pending', limit: 2 });
    expect(add.mock.calls[0][0].itemKey).toBe('ORD-42');
  });

  it('falls through when the actor holds no claim, two claims, or a lapsed one', async () => {
    const step = { query: {}, verb: SCAN_VERBS.ACCUMULATE, params: { itemKey: '{claim.orderId}' } } as ScanStep;
    listClaims.mockResolvedValue({ escalations: [], total: 0 });
    expect(await accumulateStep(step, ctx)).toBeNull();
    listClaims.mockResolvedValue({ escalations: [liveClaim({ orderId: 'a' }), liveClaim({ orderId: 'b' })], total: 2 });
    expect(await accumulateStep(step, ctx)).toBeNull();
    listClaims.mockResolvedValue({ escalations: [{ ...liveClaim({ orderId: 'a' }), assigned_until: new Date(Date.now() - 1000) }], total: 1 });
    expect(await accumulateStep(step, ctx)).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it('falls through when the claim lacks the facet, never writing the literal', async () => {
    listClaims.mockResolvedValue({ escalations: [liveClaim({ other: 'x' })], total: 1 });
    const step = { query: {}, verb: SCAN_VERBS.ACCUMULATE, params: { itemKey: '{claim.orderId}' } } as ScanStep;
    expect(await accumulateStep(step, ctx)).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('accumulateStep — outcome mapping', () => {
  it('item mode answers no_open_container with the item row when no pending container carries the facet', async () => {
    add.mockResolvedValue({ status: 404, error: 'No pending escalation found for this metadata' });
    const result = await accumulateStep(itemLocate(), ctx);
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.NO_OPEN_CONTAINER);
    expect(result?.data?.escalation).toBe(member);
    expect(result?.data?.container).toEqual({ facet: 'binKey', value: 'B-7' });
    expect(result?.data?.fallback).toBe(ctx.rule.fallback);
    expect(result?.data?.error).toMatch(/binKey = B-7/);
  });

  it('container mode still falls through on 404, and maps 403 to forbidden, 409 to conflict', async () => {
    add.mockResolvedValue({ status: 404, error: 'nope' });
    const containerMode = { query: {}, verb: SCAN_VERBS.ACCUMULATE, params: { itemKey: 'x' } } as ScanStep;
    expect(await accumulateStep(containerMode, ctx)).toBeNull();
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
