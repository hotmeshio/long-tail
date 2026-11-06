import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/escalations/accumulate', () => ({ accumulateItem: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({ getEscalationReadScope: vi.fn() }));
vi.mock('../../api/escalations/metadata', () => ({ restrictScopeRoles: vi.fn() }));
vi.mock('../../services/escalation', () => ({ searchByFacets: vi.fn() }));
vi.mock('../../api/scan-codes/subject', () => ({ claimedByOther: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ spendGrant: vi.fn(), identityGate: vi.fn() }));

import { accumulateItem } from '../../api/escalations/accumulate';
import { getEscalationReadScope } from '../../api/escalations/helpers';
import { restrictScopeRoles } from '../../api/escalations/metadata';
import * as escalationService from '../../services/escalation';
import { claimedByOther } from '../../api/scan-codes/subject';
import { identityGate, spendGrant } from '../../api/scan-codes/grant';
import { accumulateIntoSubject } from '../../api/scan-codes/verb-into-subject';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

// On an add into the held subject, match.facets compares the held row with
// the scanned item's own row: a container collects only items on its own route.

const add = vi.mocked(accumulateItem);
const search = vi.mocked(escalationService.searchByFacets);

const HELD = { id: 'container-row', role: 'transfer', metadata: { route: 'A:B', accumulate_count: 0 } };
const bagRow = (metadata: Record<string, unknown>) => ({ id: 'bag-row', metadata: { bagCode: 'BAG-1', ...metadata } });

const ctx = (subject = HELD) => ({
  scheme: { version: 11, target_facet: 'bagCode' },
  rule: { name: 'Bag Into Container', notPrimed: {}, fallback: {} },
  parsed: { version: 11, category: '0', target: 'BAG-1' },
  scannedAt: '2026-11-05T00:00:00Z',
  auth: { userId: 'maria' }, stationAuth: { userId: 'station-1' }, acting: true,
  subject: { row: subject, code: '15:0:T-1', parsed: { target: 'T-1' }, scheme: { version: 15 } },
}) as any;

const step = (over: Partial<ScanStep> = {}): ScanStep => ({
  query: {}, verb: 'accumulate', subject: { schemes: [15] },
  match: { facets: ['route'] },
  refuse: { markdown: 'That item goes on another route. This container runs {container.route}.' },
  params: { itemKey: '{scan.target}', accumulate: { into: 'subject', item: { roles: ['transfer'] } } },
  ...over,
} as ScanStep);

const located = (row: unknown) => search.mockResolvedValue({ escalations: [row], total: 1 } as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEscalationReadScope).mockResolvedValue({ global: false, allRoles: ['transfer'], selfRoles: [] } as any);
  vi.mocked(restrictScopeRoles).mockReturnValue(['transfer']);
  vi.mocked(claimedByOther).mockResolvedValue(null);
  vi.mocked(spendGrant).mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
  add.mockResolvedValue({ status: 200, data: { outcome: 'accepted', count: 1, remaining: null, escalationId: 'container-row' } });
});

describe('accumulateIntoSubject match.facets', () => {
  it('refuses an item on another route with the step copy, nothing written', async () => {
    located(bagRow({ route: 'A:C' }));
    const result = await accumulateIntoSubject(step(), ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED });
    expect(result?.data?.refusal?.markdown).toBe('That item goes on another route. This container runs A:B.');
    expect(add).not.toHaveBeenCalled();
    expect(spendGrant).not.toHaveBeenCalled();
  });

  it('adds an item on the same route', async () => {
    located(bagRow({ route: 'A:B' }));
    const result = await accumulateIntoSubject(step(), ctx());
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ id: 'container-row', reciprocal: { id: 'bag-row' } }), { userId: 'maria' });
  });

  it('refuses when the item lacks the facet', async () => {
    located(bagRow({}));
    expect((await accumulateIntoSubject(step(), ctx()))?.data?.outcome).toBe(SCAN_OUTCOMES.REFUSED);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses when the held subject lacks the facet', async () => {
    located(bagRow({ route: 'A:B' }));
    const bare = { ...HELD, metadata: { accumulate_count: 0 } };
    expect((await accumulateIntoSubject(step(), ctx(bare)))?.data?.outcome).toBe(SCAN_OUTCOMES.REFUSED);
    expect(add).not.toHaveBeenCalled();
  });

  it('compares values as strings', async () => {
    const numbered = { ...HELD, metadata: { lane: 7 } };
    located(bagRow({ lane: '7' }));
    const result = await accumulateIntoSubject(step({ match: { facets: ['lane'] } }), ctx(numbered));
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
  });

  it('without accumulate.item, a facet the held subject carries passes as before', async () => {
    const plain = step({ params: { itemKey: '{scan.target}', accumulate: { into: 'subject' } } });
    expect((await accumulateIntoSubject(plain, ctx()))?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    expect(search).not.toHaveBeenCalled();
  });
});
