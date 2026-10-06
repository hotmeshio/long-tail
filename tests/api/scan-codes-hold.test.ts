import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/scan-codes/locate', () => ({ locateForStep: vi.fn() }));
vi.mock('../../api/scan-codes/subject', () => ({ claimedByOther: vi.fn() }));
vi.mock('../../services/escalation', () => ({ listEscalations: vi.fn() }));

import { locateForStep } from '../../api/scan-codes/locate';
import { claimedByOther } from '../../api/scan-codes/subject';
import { holdStep } from '../../api/scan-codes/hold';
import { SCAN_OUTCOMES, SCAN_VERBS, type ScanStep } from '../../types';

const locate = vi.mocked(locateForStep);
const claimant = vi.mocked(claimedByOther);

const ROW = { id: 'bag-row', metadata: { orderSlug: 'K7Q2M9XA', binCode: 'SF-A-2' } } as any;
const ctx = (over: Record<string, unknown> = {}) => ({
  scheme: { version: 11, target_facet: 'orderSlug', encoding: 'delimited', delimiter: ':' },
  rule: { name: 'Work It', notPrimed: {}, fallback: {} },
  parsed: { version: 11, category: '0', target: 'K7Q2M9XA' },
  rawCode: '11:0:K7Q2M9XA',
  scannedAt: '2026-10-05T00:00:00Z',
  auth: { userId: 'station-1' }, stationAuth: { userId: 'station-1' }, acting: false,
  ...over,
}) as any;

const step: ScanStep = {
  query: { roles: ['binning-associate'] },
  verb: SCAN_VERBS.HOLD,
  params: { hold: { ttlSeconds: 30, label: 'Bag {scan.target}', expect: { schemes: [14], prompt: 'Scan tub **{item.binCode}**' } } },
};

beforeEach(() => {
  vi.clearAllMocks();
  locate.mockResolvedValue({ escalations: [ROW], total: 1 });
  claimant.mockResolvedValue(null);
});

describe('holdStep', () => {
  it('hands the station a subject: the code it scanned, the row, the next scan', async () => {
    const before = Date.now();
    const result = await holdStep(step, ctx());
    expect(result?.data).toMatchObject({
      outcome: SCAN_OUTCOMES.HELD,
      escalation: ROW,
      subject: {
        code: '11:0:K7Q2M9XA', escalationId: 'bag-row', label: 'Bag K7Q2M9XA',
        expect: { schemes: [14], prompt: 'Scan tub **SF-A-2**' },
      },
    });
    const expires = Date.parse(result!.data!.subject!.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 30_000);
    expect(result?.data?.subject?.claimedBy).toBeUndefined();
  });

  it('nothing located falls through', async () => {
    locate.mockResolvedValue({ escalations: [], total: 0 });
    expect(await holdStep(step, ctx())).toBeNull();
  });

  it('reports whose claim it is instead of refusing', async () => {
    claimant.mockResolvedValue({ id: 'maria', displayName: 'Maria' });
    const result = await holdStep(step, ctx());
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.HELD);
    expect(result?.data?.subject?.claimedBy).toEqual({ id: 'maria', displayName: 'Maria' });
  });

  it('a hold executed as a choice rebuilds the code from the row', async () => {
    const result = await holdStep(step, ctx({ rawCode: undefined }), ROW);
    expect(locate).not.toHaveBeenCalled();
    expect(result?.data?.subject?.code).toBe('11:0:K7Q2M9XA');
  });

  it('a headline and subline name where the item goes; an empty render drops the line', async () => {
    locate.mockResolvedValue({ escalations: [{ id: 'bag-row', metadata: { binCode: 'SF-A-2', facilityName: 'Acme East' } } as any], total: 1 });
    const result = await holdStep({
      query: {}, verb: SCAN_VERBS.HOLD,
      params: { hold: { headline: '{item.binCode}', subline: '{item.facilityName}' } },
    }, ctx());
    expect(result?.data?.subject).toMatchObject({ headline: 'SF-A-2', subline: 'Acme East' });

    locate.mockResolvedValue({ escalations: [{ id: 'bag-row', metadata: {} } as any], total: 1 });
    const bare = await holdStep({ query: {}, verb: SCAN_VERBS.HOLD, params: { hold: { headline: '{item.binCode}' } } }, ctx());
    expect(bare?.data?.subject?.headline).toBeUndefined();
  });

  it('defaults: 45 s, the target as label, no expectation', async () => {
    const result = await holdStep({ query: {}, verb: SCAN_VERBS.HOLD }, ctx());
    expect(result?.data?.subject?.label).toBe('K7Q2M9XA');
    expect(result?.data?.subject?.expect).toBeUndefined();
  });
});
