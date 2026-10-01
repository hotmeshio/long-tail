import { describe, it, expect, vi, beforeEach } from 'vitest';

// Item mode forwards the step's container selector; containerRoles stays an alias.
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
import { locateForStep } from '../../api/scan-codes/locate';
import { accumulateStep } from '../../api/scan-codes/verbs';
import { SCAN_VERBS, type ScanStep } from '../../types';

const add = vi.mocked(accumulateItemByMetadata);
const locate = vi.mocked(locateForStep);
const SLOT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ctx = {
  scheme: { version: 11, target_facet: 'bagCode' },
  rule: { name: 'Box It', notPrimed: {}, fallback: { markdown: 'Scan again' } },
  parsed: { version: 11, category: '4', target: 'VC531C38' },
  scannedAt: '2026-01-01T00:00:00Z',
  auth: { userId: 'u1' }, stationAuth: { userId: 'u1' }, acting: true,
} as any;

const step = (accumulate: Record<string, unknown>): ScanStep => ({
  query: { roles: ['match-filling'] }, verb: SCAN_VERBS.ACCUMULATE, params: { accumulate },
} as ScanStep);

beforeEach(() => {
  vi.clearAllMocks();
  locate.mockResolvedValue({ escalations: [{ id: SLOT_ID, metadata: { bagCode: 'VC531C38', boxKey: 'BX-1' } } as any], total: 1 });
  add.mockResolvedValue({ status: 200, data: { outcome: 'accepted', count: 1, remaining: 3, escalationId: 'box' } });
});

describe('accumulateStep container selector', () => {
  it('forwards types, subtypes and facets, and container.roles as the role restriction', async () => {
    await accumulateStep(step({
      containerFacet: 'boxKey',
      container: { roles: ['match-filling'], types: ['matchBox'], subtypes: ['box'], facets: { open: true } },
    }), ctx);
    expect(add.mock.calls[0][0]).toMatchObject({
      key: 'boxKey', value: 'BX-1', restrictRoles: ['match-filling'],
      container: { types: ['matchBox'], subtypes: ['box'], facets: { open: true } },
      reciprocal: { id: SLOT_ID },
    });
  });

  it('containerRoles still restricts roles when no container is declared', async () => {
    await accumulateStep(step({ containerFacet: 'boxKey', containerRoles: ['match-filling'] }), ctx);
    expect(add.mock.calls[0][0]).toMatchObject({ restrictRoles: ['match-filling'] });
    expect(add.mock.calls[0][0].container).toBeUndefined();
  });

  it('container.roles wins over containerRoles', async () => {
    await accumulateStep(step({ containerFacet: 'boxKey', containerRoles: ['old'], container: { roles: ['new'] } }), ctx);
    expect(add.mock.calls[0][0].restrictRoles).toEqual(['new']);
  });

  it('an item-mode payload template reads the located row, so the add can carry the label field', async () => {
    locate.mockResolvedValue({
      escalations: [{ id: SLOT_ID, metadata: { bagCode: 'VC531C38', boxKey: 'BX-1', orderSlug: 'VC531C38' } } as any], total: 1,
    });
    const labelled = { ...step({ containerFacet: 'boxKey' }), params: {
      accumulate: { containerFacet: 'boxKey' }, resolverPayload: { stickerCode: '{item.orderSlug}' },
    } } as ScanStep;
    await accumulateStep(labelled, ctx);
    expect(add.mock.calls[0][0].payload).toEqual({ stickerCode: 'VC531C38' });
  });

  it('a payload token the located row cannot fill falls through without adding', async () => {
    const labelled = { ...step({ containerFacet: 'boxKey' }), params: {
      accumulate: { containerFacet: 'boxKey' }, resolverPayload: { stickerCode: '{item.orderSlug}' },
    } } as ScanStep;
    expect(await accumulateStep(labelled, ctx)).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });
});
