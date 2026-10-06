import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/escalations/resolve-batch', () => ({ resolveBatchItem: vi.fn() }));
vi.mock('../../services/escalation', () => ({ getEscalation: vi.fn() }));
vi.mock('../../api/scan-codes/locate', () => ({ locateForStep: vi.fn() }));
vi.mock('../../api/scan-codes/subject', () => ({ claimedByOther: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ spendGrant: vi.fn(), identityGate: vi.fn() }));

import { resolveBatchItem } from '../../api/escalations/resolve-batch';
import * as escalationService from '../../services/escalation';
import { claimedByOther } from '../../api/scan-codes/subject';
import { identityGate, spendGrant } from '../../api/scan-codes/grant';
import { fillStep } from '../../api/scan-codes/verb-fill';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const fill = vi.mocked(resolveBatchItem);
const SHOE = '00012345678905';
const OTHER = '00036000291452';

const orderRow = (pending: string[], keys = [`${SHOE}#1`, `${SHOE}#2`, OTHER]) =>
  ({ id: 'order-row', metadata: { batch_pending: pending, batch_keys: keys } }) as any;

const ctx = (row: any, target = SHOE) => ({
  scheme: { version: 16, target_facet: 'upc' },
  rule: { name: 'Shoe', notPrimed: {}, fallback: {} },
  parsed: { version: 16, category: '0', target, raw: target.slice(2) },
  scannedAt: '2026-10-05T00:00:00Z',
  auth: { userId: 'maria' }, stationAuth: { userId: 'station-1' }, acting: true,
  subject: { row, code: '11:0:K7Q2M9XA', parsed: { target: 'K7Q2M9XA' }, scheme: { version: 11 } },
}) as any;

const step: ScanStep = {
  query: {}, verb: 'fill', subject: { schemes: [11] },
  refuse: { markdown: 'Not this order\'s shoe. Expecting {fill.pending}.' },
  params: { fill: { into: 'subject', payload: { upc: '{scan.target}' } } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimedByOther).mockResolvedValue(null);
  vi.mocked(spendGrant).mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
});

describe('fillStep', () => {
  it('fills the first open slot for the scanned code and reports progress', async () => {
    fill.mockResolvedValue({ status: 200, data: { outcome: 'accepted', remaining: 2, escalationId: 'order-row' } });
    const result = await fillStep(step, ctx(orderRow([`${SHOE}#1`, `${SHOE}#2`, OTHER])));
    expect(fill).toHaveBeenCalledWith(expect.objectContaining({ id: 'order-row', itemKey: `${SHOE}#1`, resolverPayload: { upc: SHOE } }), { userId: 'maria' });
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, progress: { filled: 1, total: 3, remaining: 2 } });
    expect(result?.data?.clearSubject).toBeUndefined();
  });

  it('the second pair of the same shoe takes the second slot; the last fill clears the subject', async () => {
    fill.mockResolvedValue({ status: 200, data: { outcome: 'completed', remaining: 0, escalationId: 'order-row' } });
    const result = await fillStep(step, ctx(orderRow([`${SHOE}#2`])));
    expect(fill.mock.calls[0][0].itemKey).toBe(`${SHOE}#2`);
    expect(result?.data).toMatchObject({ progress: { filled: 3, total: 3, remaining: 0 }, clearSubject: true });
  });

  it('the done copy can say how far the order has come', async () => {
    fill.mockResolvedValue({ status: 200, data: { outcome: 'accepted', remaining: 2 } });
    const result = await fillStep({ ...step, done: { markdown: '{fill.filled} of {fill.total} checked off.' } }, ctx(orderRow([`${SHOE}#1`, `${SHOE}#2`, OTHER])));
    expect(result?.data?.done).toEqual({ markdown: '1 of 3 checked off.' });
  });

  it('a third scan of a two-pair shoe is refused with nothing written', async () => {
    const result = await fillStep(step, ctx(orderRow([OTHER])));
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, refusal: { markdown: 'All 2 of these are already checked off.' } });
    expect(fill).not.toHaveBeenCalled();
    expect(spendGrant).not.toHaveBeenCalled();
  });

  it('a shoe the order does not expect is refused, naming what it does expect', async () => {
    const result = await fillStep(step, ctx(orderRow([`${SHOE}#1`, OTHER]), '00099999999999'));
    expect(result?.data?.refusal).toEqual({
      markdown: `Not this order's shoe. Expecting ${SHOE}, ${OTHER}.`,
      expected: [SHOE, OTHER],
    });
  });

  it('a slot another bench just filled moves to the next', async () => {
    fill
      .mockResolvedValueOnce({ status: 409, error: 'Batch item already submitted', data: { outcome: 'duplicate-item' } })
      .mockResolvedValueOnce({ status: 200, data: { outcome: 'accepted', remaining: 1 } });
    await fillStep(step, ctx(orderRow([`${SHOE}#1`, `${SHOE}#2`, OTHER])));
    expect(fill.mock.calls.map((c) => c[0].itemKey)).toEqual([`${SHOE}#1`, `${SHOE}#2`]);
  });

  it('every slot lost to a race is refused', async () => {
    fill.mockResolvedValue({ status: 409, error: 'dup', data: { outcome: 'duplicate-item' } });
    vi.mocked(escalationService.getEscalation).mockResolvedValue(orderRow([OTHER]));
    expect((await fillStep(step, ctx(orderRow([`${SHOE}#1`]))))?.data?.outcome).toBe(SCAN_OUTCOMES.REFUSED);
  });

  it('someone else\'s claim on the order refuses', async () => {
    vi.mocked(claimedByOther).mockResolvedValue({ id: 'sam', displayName: 'Sam' });
    expect((await fillStep(step, ctx(orderRow([`${SHOE}#1`]))))?.data?.refusal?.markdown).toBe('Claimed by **Sam**.');
  });
});
