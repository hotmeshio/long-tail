import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/escalations/resolve-batch', () => ({ resolveBatchItem: vi.fn() }));
vi.mock('../../services/escalation', () => ({ getEscalation: vi.fn() }));
vi.mock('../../api/scan-codes/locate', () => ({ locateForStep: vi.fn() }));
vi.mock('../../api/scan-codes/subject', () => ({ claimedByOther: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ spendGrant: vi.fn(), identityGate: vi.fn() }));

import { resolveBatchItem } from '../../api/escalations/resolve-batch';
import { claimedByOther } from '../../api/scan-codes/subject';
import { identityGate, spendGrant } from '../../api/scan-codes/grant';
import { fillStep } from '../../api/scan-codes/verb-fill';
import { preferredKeys } from '../../api/scan-codes/fill-labels';
import type { ScanStep } from '../../types';

// fill.prefer: when one code is expected under several keys, each tied to a
// value (the parcel it ships in), the key the held subject's target names fills first.

const fill = vi.mocked(resolveBatchItem);
const ITEM = '00812999000011';
const OWNERS = { [`${ITEM}#1`]: 'P1', [`${ITEM}#2`]: 'P2' };

const row = (envelope: Record<string, unknown> = { key_owners: OWNERS }) =>
  ({ id: 'receiving-row', role: 'receiving', metadata: { batch_pending: [`${ITEM}#1`, `${ITEM}#2`] }, envelope }) as any;

const ctx = (r: any, held: string) => ({
  scheme: { version: 16, target_facet: 'upc', encoding: 'fixed' },
  rule: { name: 'Receive', notPrimed: {}, fallback: {} },
  parsed: { version: 16, category: '0', target: ITEM },
  scannedAt: '2026-11-06T00:00:00Z',
  auth: { userId: 'dock' }, stationAuth: { userId: 'dock' }, acting: false,
  subject: { row: r, code: `12:0:${held}`, parsed: { target: held }, scheme: { version: 12 } },
}) as any;

const step = (prefer?: string): ScanStep => ({
  query: {}, verb: 'fill', subject: { schemes: [12] },
  params: { fill: { into: 'subject', ...(prefer ? { prefer } : {}) } },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimedByOther).mockResolvedValue(null);
  vi.mocked(spendGrant).mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
  fill.mockResolvedValue({ status: 200, data: { outcome: 'accepted', remaining: 1 } });
});

describe('fill.prefer', () => {
  it('held by the second value, the scan fills the second key', async () => {
    await fillStep(step('envelope.key_owners'), ctx(row(), 'P2'));
    expect(fill.mock.calls[0][0].itemKey).toBe(`${ITEM}#2`);
  });

  it('held by the first value, or with no map, the first key fills as before', async () => {
    await fillStep(step('envelope.key_owners'), ctx(row(), 'P1'));
    expect(fill.mock.calls[0][0].itemKey).toBe(`${ITEM}#1`);
    fill.mockClear();
    await fillStep(step('envelope.key_owners'), ctx(row({}), 'P2'));
    expect(fill.mock.calls[0][0].itemKey).toBe(`${ITEM}#1`);
    fill.mockClear();
    await fillStep(step(), ctx(row(), 'P2'));
    expect(fill.mock.calls[0][0].itemKey).toBe(`${ITEM}#1`);
  });

  it('the preferred key taken since the read moves on to the rest', async () => {
    fill.mockResolvedValueOnce({ status: 409, data: { outcome: 'duplicate-item' } } as any);
    await fillStep(step('envelope.key_owners'), ctx(row(), 'P2'));
    expect(fill.mock.calls.map((c) => c[0].itemKey)).toEqual([`${ITEM}#2`, `${ITEM}#1`]);
  });
});

describe('preferredKeys', () => {
  const keys = ['A#1', 'A#2', 'A#3'];
  const r = (map: unknown) => ({ envelope: { owners: map } }) as any;

  it('moves the owned keys first and keeps the rest in order; a list value owns by membership', () => {
    expect(preferredKeys(keys, { into: 'subject', prefer: 'envelope.owners' }, r({ 'A#3': 'P9' }), 'P9')).toEqual(['A#3', 'A#1', 'A#2']);
    expect(preferredKeys(keys, { into: 'subject', prefer: 'envelope.owners' }, r({ 'A#2': ['P1', 'P9'] }), 'P9')).toEqual(['A#2', 'A#1', 'A#3']);
  });

  it('compares as text; without a held target nothing moves', () => {
    expect(preferredKeys(keys, { into: 'subject', prefer: 'envelope.owners' }, r({ 'A#2': 7 }), '7')).toEqual(['A#2', 'A#1', 'A#3']);
    expect(preferredKeys(keys, { into: 'subject', prefer: 'envelope.owners' }, r({ 'A#2': 'P9' }), undefined)).toEqual(keys);
  });
});
