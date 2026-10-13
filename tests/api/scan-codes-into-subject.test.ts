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

const add = vi.mocked(accumulateItem);
const search = vi.mocked(escalationService.searchByFacets);
const claimant = vi.mocked(claimedByOther);
const spend = vi.mocked(spendGrant);
const scopeRoles = vi.mocked(restrictScopeRoles);

const BOX = {
  id: 'box-row',
  metadata: { binCode: 'SF-A-2', memberCodes: ['K7Q2M9XA', 'P3R8T1ZB'], accumulate_count: 0, accumulate_max: 2 },
};
const ORDER = { id: 'order-row', metadata: { itemCode: 'K7Q2M9XA', orderId: 'ord-1', shape: 'consolidated' } };
const ctx = (target = 'K7Q2M9XA') => ({
  scheme: { version: 11, target_facet: 'itemCode' },
  rule: { name: 'Pack Bag', notPrimed: {}, fallback: {} },
  parsed: { version: 11, category: '0', target },
  scannedAt: '2026-10-06T00:00:00Z',
  auth: { userId: 'maria' }, stationAuth: { userId: 'station-1' }, acting: true,
  subject: { row: BOX, code: '14:0:SF-A-2', parsed: { target: 'SF-A-2' }, scheme: { version: 14 } },
}) as any;

const packing = (over: Partial<ScanStep> = {}): ScanStep => ({
  query: { roles: ['packing'], status: 'pending' }, verb: 'accumulate', subject: { schemes: [14] },
  match: { target: ['{subject.memberCodes}'] },
  refuse: { markdown: 'Not one of this bin’s bags.', missing: 'That bag is not waiting to be packed.' },
  done: { markdown: '{item.itemCode} is in the box. {container.accumulate_count} of {container.accumulate_max}.' },
  params: {
    itemKey: '{scan.target}', resolverPayload: { stickerCode: '{scan.target}' },
    accumulate: { into: 'subject', item: { roles: ['ship'], facets: { shape: 'consolidated' } } },
  },
  ...over,
} as ScanStep);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEscalationReadScope).mockResolvedValue({ global: false, allRoles: ['ship'], selfRoles: [] } as any);
  scopeRoles.mockReturnValue(['ship']);
  search.mockResolvedValue({ escalations: [ORDER], total: 1 } as any);
  claimant.mockResolvedValue(null);
  spend.mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
  add.mockResolvedValue({ status: 200, data: { outcome: 'accepted', count: 1, remaining: 1, escalationId: 'box-row' } });
});

describe('accumulateIntoSubject without item', () => {
  const into: ScanStep = {
    query: {}, verb: 'accumulate', subject: { schemes: [11] }, match: { target: ['{subject.binCode}'] },
    params: { resolverPayload: { binCode: '{scan.target}' }, accumulate: { into: 'subject' } },
  };
  const bag = (target: string) => ({
    ...ctx(target), scheme: { version: 14, target_facet: 'binCode' },
    subject: { row: { id: 'bag-row', metadata: { binCode: 'SF-A-2' } }, code: '11:0:K7', parsed: {}, scheme: { version: 11 } },
  });

  it('the subject row collects the code with no reciprocal and no locate', async () => {
    add.mockResolvedValue({ status: 200, data: { outcome: 'completed', count: 1, remaining: 0, escalationId: 'bag-row' } });
    const result = await accumulateIntoSubject(into, bag('SF-A-2'));
    expect(add).toHaveBeenCalledWith({ id: 'bag-row', itemKey: 'SF-A-2', payload: { binCode: 'SF-A-2' }, metadata: expect.any(Object) }, { userId: 'maria' });
    expect(search).not.toHaveBeenCalled();
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, clearSubject: true, progress: { filled: 1, total: 1, remaining: 0 } });
  });

  it('a code that is not the offered one is refused', async () => {
    expect((await accumulateIntoSubject(into, bag('SF-C-1')))?.data?.outcome).toBe(SCAN_OUTCOMES.REFUSED);
    expect(add).not.toHaveBeenCalled();
  });

  it('an unbounded accumulator reports no progress', async () => {
    add.mockResolvedValue({ status: 200, data: { outcome: 'accepted', count: 4, remaining: null, escalationId: 'bag-row' } });
    expect((await accumulateIntoSubject(into, bag('SF-A-2')))?.data?.progress).toBeUndefined();
  });
});

describe('accumulateIntoSubject with item', () => {
  it('locates the order row and writes it as the reciprocal in the same add', async () => {
    const result = await accumulateIntoSubject(packing(), ctx());
    expect(scopeRoles).toHaveBeenCalledWith(['ship'], false, ['ship']);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['ship'], status: 'pending', exists: ['accumulate_count'],
      facets: { shape: 'consolidated', itemCode: 'K7Q2M9XA' },
    }), { total: false });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'box-row', itemKey: 'K7Q2M9XA', payload: { stickerCode: 'K7Q2M9XA' }, reciprocal: { id: 'order-row' },
    }), { userId: 'maria' });
    expect(result?.data).toMatchObject({
      outcome: SCAN_OUTCOMES.EXECUTED, clearSubject: false,
      progress: { filled: 1, total: 2, remaining: 1 },
      done: { markdown: 'K7Q2M9XA is in the box. 1 of 2.' },
    });
  });

  it('never picks the held subject row as the item', async () => {
    search.mockResolvedValue({ escalations: [BOX, ORDER], total: 2 } as any);
    await accumulateIntoSubject(packing(), ctx());
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ reciprocal: { id: 'order-row' } }), expect.anything());
  });

  it('a bag that is not in this bin is refused with nothing spent', async () => {
    const result = await accumulateIntoSubject(packing(), ctx('Z9Z9Z9Z9'));
    expect(result?.data?.refusal?.markdown).toBe('Not one of this bin’s bags.');
    expect(add).not.toHaveBeenCalled();
    expect(spend).not.toHaveBeenCalled();
  });

  it('no waiting row refuses with the missing copy and keeps the box held', async () => {
    search.mockResolvedValue({ escalations: [], total: 0 } as any);
    const result = await accumulateIntoSubject(packing(), ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, clearSubject: false });
    expect(result?.data?.refusal?.markdown).toBe('That bag is not waiting to be packed.');
    expect(add).not.toHaveBeenCalled();
  });

  it('no waiting row and no missing copy falls through', async () => {
    search.mockResolvedValue({ escalations: [], total: 0 } as any);
    const step = packing({ refuse: { markdown: 'Not one of this bin’s bags.' } });
    expect(await accumulateIntoSubject(step, ctx())).toBeNull();
  });

  it('two waiting rows for one code is a conflict, nothing written', async () => {
    search.mockResolvedValue({ escalations: [ORDER, { ...ORDER, id: 'order-row-2' }], total: 2 } as any);
    expect((await accumulateIntoSubject(packing(), ctx()))?.data?.outcome).toBe(SCAN_OUTCOMES.CONFLICT);
    expect(add).not.toHaveBeenCalled();
  });

  it('an order claimed by someone else is refused unless the step allows it', async () => {
    claimant.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'u2', displayName: 'Ana' });
    const result = await accumulateIntoSubject(packing(), ctx());
    expect(result?.data?.refusal?.markdown).toBe('Claimed by **Ana**.');
    expect(add).not.toHaveBeenCalled();
  });

  it('an actor with no role in the item selector cannot locate it', async () => {
    scopeRoles.mockReturnValue([]);
    const result = await accumulateIntoSubject(packing(), ctx());
    expect(search).not.toHaveBeenCalled();
    expect(result?.data?.refusal?.markdown).toBe('That bag is not waiting to be packed.');
  });

  it('an order already placed elsewhere is refused and the box stays held', async () => {
    add.mockResolvedValue({ status: 409, error: 'reciprocal terminal', data: { outcome: 'reciprocal-terminal' } } as any);
    const result = await accumulateIntoSubject(packing(), ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, clearSubject: false });
    expect(result?.data?.refusal?.markdown).toBe('This one is already placed.');
  });

  it('an order row that vanished before the write answers missing', async () => {
    add.mockResolvedValue({ status: 404, error: 'gone', data: { outcome: 'reciprocal-not-found' } } as any);
    expect((await accumulateIntoSubject(packing(), ctx()))?.data?.refusal?.markdown).toBe('That bag is not waiting to be packed.');
  });

  it('the same bag twice is already, nothing new written, and the box stays held', async () => {
    add.mockResolvedValue({ status: 409, error: 'dup', data: { outcome: 'duplicate-item' } } as any);
    expect((await accumulateIntoSubject(packing(), ctx()))?.data).toMatchObject({ already: true, clearSubject: false });
  });

  it('a match that reads the item row answers missing, not mismatch, when no row waits', async () => {
    search.mockResolvedValue({ escalations: [], total: 0 } as any);
    const step = packing({ match: { target: ['{item.itemCode}'] } });
    expect((await accumulateIntoSubject(step, ctx()))?.data?.refusal?.markdown).toBe('That bag is not waiting to be packed.');
  });

  it('the locate skips the count query', async () => {
    await accumulateIntoSubject(packing(), ctx());
    expect(search.mock.calls[0][1]).toEqual({ total: false });
  });

  it('the last bag completes the box and drops the hold', async () => {
    add.mockResolvedValue({ status: 200, data: { outcome: 'completed', count: 2, remaining: 0, escalationId: 'box-row' } });
    const result = await accumulateIntoSubject(packing(), ctx());
    expect(result?.data).toMatchObject({ clearSubject: true, done: { markdown: 'K7Q2M9XA is in the box. 2 of 2.' } });
  });
});
