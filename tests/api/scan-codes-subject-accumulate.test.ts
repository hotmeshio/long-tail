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
import { accumulateFromSubject } from '../../api/scan-codes/verbs-subject';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const add = vi.mocked(accumulateItem);
const search = vi.mocked(escalationService.searchByFacets);
const claimant = vi.mocked(claimedByOther);
const spend = vi.mocked(spendGrant);

const BAG = { id: 'bag-row', metadata: { orderId: 'ord-1', orderSlug: 'K7Q2M9XA', binCode: 'SF-A-2', boxKey: 'SF:LA' } };
const TUB = { id: 'tub-row', metadata: { binCode: 'SF-A-2', facilityName: 'Acme East', boxKey: 'SF:LA' } };
const ctx = (target = 'SF-A-2') => ({
  scheme: { version: 14, target_facet: 'binCode' },
  rule: { name: 'Bin It', notPrimed: {}, fallback: {} },
  parsed: { version: 14, category: '0', target },
  scannedAt: '2026-10-05T00:00:00Z',
  auth: { userId: 'maria' }, stationAuth: { userId: 'station-1' }, acting: true,
  subject: { row: BAG, code: '11:0:K7Q2M9XA', parsed: { target: 'K7Q2M9XA' }, scheme: { version: 11 } },
}) as any;

const fromSubject = (over: Partial<ScanStep> = {}): ScanStep => ({
  query: { roles: ['bin-packer'] }, verb: 'accumulate', subject: { schemes: [11] },
  match: { target: ['{subject.binCode}'] },
  refuse: { markdown: "That's {container.facilityName}'s tub. This bag goes in **{subject.binCode}**.", conflict: 'That tub was just taken.' },
  params: { itemKey: '{subject.orderId}', resolverPayload: { stickerCode: '{subject.orderSlug}' },
    accumulate: { from: 'subject', container: { types: ['bin'], subtypes: ['open', 'free'] } } },
  ...over,
} as ScanStep);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEscalationReadScope).mockResolvedValue({ global: true, allRoles: [], selfRoles: [] } as any);
  vi.mocked(restrictScopeRoles).mockReturnValue(['bin-packer']);
  search.mockResolvedValue({ escalations: [TUB], total: 1 } as any);
  claimant.mockResolvedValue(null);
  spend.mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
  add.mockResolvedValue({ status: 200, data: { outcome: 'completed', count: 3, remaining: 0, escalationId: 'tub-row' } });
});

describe('accumulateFromSubject', () => {
  it('joins the held bag to the scanned tub, the bag row as reciprocal, by id', async () => {
    const result = await accumulateFromSubject(fromSubject(), ctx());
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tub-row', itemKey: 'ord-1', payload: { stickerCode: 'K7Q2M9XA' }, reciprocal: { id: 'bag-row' },
    }), { userId: 'maria' });
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, clearSubject: true });
    expect(search.mock.calls[0][0]).toMatchObject({ facets: { binCode: 'SF-A-2' }, types: ['bin'], subtypes: ['open', 'free'], exists: ['accumulate_count'] });
  });

  it('a placed order carries the done copy, reading the container it landed in', async () => {
    const result = await accumulateFromSubject(fromSubject({ done: { markdown: 'Drop it in **{container.binCode}**. All good.' } }), ctx());
    expect(result?.data?.done).toEqual({ markdown: 'Drop it in **SF-A-2**. All good.' });
  });

  it('an order already in place gets no done copy', async () => {
    add.mockResolvedValue({ status: 409, error: 'Item already held', data: { outcome: 'duplicate-item' } });
    const result = await accumulateFromSubject(fromSubject({ done: { markdown: 'Drop it in.' } }), ctx());
    expect(result?.data).toMatchObject({ already: true });
    expect(result?.data?.done).toBeUndefined();
  });

  it('the wrong tub is refused, names the right one, and writes nothing', async () => {
    search.mockResolvedValue({ escalations: [{ ...TUB, metadata: { binCode: 'SF-B-9', facilityName: 'Acme West' } }], total: 1 } as any);
    const result = await accumulateFromSubject(fromSubject(), ctx('SF-B-9'));
    expect(result?.data).toMatchObject({
      outcome: SCAN_OUTCOMES.REFUSED,
      refusal: { markdown: "That's Acme West's tub. This bag goes in **SF-A-2**.", expected: ['SF-A-2'] },
    });
    expect(spend).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('match.facets compares the container with the subject', async () => {
    const step = fromSubject({ match: { facets: ['boxKey'] }, refuse: { markdown: 'Wrong box.' } });
    search.mockResolvedValue({ escalations: [{ ...TUB, metadata: { boxKey: 'SF:NY' } }], total: 1 } as any);
    expect((await accumulateFromSubject(step, ctx()))?.data?.outcome).toBe(SCAN_OUTCOMES.REFUSED);
    search.mockResolvedValue({ escalations: [TUB], total: 1 } as any);
    expect((await accumulateFromSubject(step, ctx()))?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
  });

  it('a matching code with no open container falls through (to an into-subject step)', async () => {
    search.mockResolvedValue({ escalations: [], total: 0 } as any);
    expect(await accumulateFromSubject(fromSubject(), ctx())).toBeNull();
  });

  it('someone else\'s live claim refuses with their name', async () => {
    claimant.mockResolvedValue({ id: 'sam', displayName: 'Sam' });
    expect((await accumulateFromSubject(fromSubject(), ctx()))?.data?.refusal?.markdown).toBe('Claimed by **Sam**.');
  });

  it('losing a shared tub refuses with the conflict copy and drops the subject', async () => {
    add.mockResolvedValue({ status: 409, error: 'x', data: { outcome: 'already-resolved' } });
    expect((await accumulateFromSubject(fromSubject(), ctx()))?.data).toMatchObject({
      outcome: SCAN_OUTCOMES.REFUSED, refusal: { markdown: 'That tub was just taken.' }, clearSubject: true,
    });
  });

  it('a bag already in this tub is harmless', async () => {
    add.mockResolvedValue({ status: 409, error: 'Item already held', data: { outcome: 'duplicate-item' } });
    expect((await accumulateFromSubject(fromSubject(), ctx()))?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, already: true });
  });

  it('the pairing is checked before the badge: a wrong tub is named with no badge held', async () => {
    vi.mocked(identityGate).mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.NOT_PRIMED, replayable: true } } as any);
    search.mockResolvedValue({ escalations: [{ ...TUB, metadata: { binCode: 'SF-B-9' } }], total: 1 } as any);
    expect((await accumulateFromSubject(fromSubject(), ctx('SF-B-9')))?.data?.outcome).toBe(SCAN_OUTCOMES.REFUSED);
    search.mockResolvedValue({ escalations: [TUB], total: 1 } as any);
    expect((await accumulateFromSubject(fromSubject(), ctx()))?.data?.outcome).toBe(SCAN_OUTCOMES.NOT_PRIMED);
    expect(add).not.toHaveBeenCalled();
  });

  it('a badge that cannot cover the act stops before the write', async () => {
    spend.mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.NOT_PRIMED, replayable: true } } as any);
    expect((await accumulateFromSubject(fromSubject(), ctx()))?.data?.outcome).toBe(SCAN_OUTCOMES.NOT_PRIMED);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('accumulateFromSubject — free bins', () => {
  const freeBin = (over: Partial<ScanStep> = {}): ScanStep => fromSubject({
    match: { target: ['{subject.freeBins}'] },
    refuse: { markdown: 'Choose a free bin: {subject.freeBins}.', missing: 'That bin was just taken. Scan the order again.' },
    ...over,
  });
  const unbound = (target: string) => {
    const c = ctx(target);
    c.subject = { ...c.subject, row: { id: 'bag-row', metadata: { orderId: 'ord-1', orderSlug: 'K7Q2M9XA', freeBins: ['SF-C-1', 'SF-C-4'] } } };
    return c;
  };

  it('a list facet allows every entry: any offered free bin takes the order', async () => {
    search.mockResolvedValue({ escalations: [{ id: 'free-row', metadata: { binCode: 'SF-C-4' } }], total: 1 } as any);
    expect((await accumulateFromSubject(freeBin(), unbound('SF-C-4')))?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    expect(add.mock.calls[0][0]).toMatchObject({ id: 'free-row', reciprocal: { id: 'bag-row' } });
  });

  it('a bin that is not offered is refused, listing the offered ones', async () => {
    const result = await accumulateFromSubject(freeBin(), unbound('SF-A-2'));
    expect(result?.data).toMatchObject({
      outcome: SCAN_OUTCOMES.REFUSED,
      refusal: { markdown: 'Choose a free bin: SF-C-1, SF-C-4.', expected: ['SF-C-1', 'SF-C-4'] },
    });
    expect(add).not.toHaveBeenCalled();
  });

  it('an offered bin with no open row refuses with the missing copy instead of falling through', async () => {
    search.mockResolvedValue({ escalations: [], total: 0 } as any);
    expect((await accumulateFromSubject(freeBin(), unbound('SF-C-1')))?.data?.refusal?.markdown)
      .toBe('That bin was just taken. Scan the order again.');
  });
});
