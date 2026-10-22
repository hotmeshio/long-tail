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
import { entryLabeler } from '../../api/scan-codes/fill-labels';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const fill = vi.mocked(resolveBatchItem);
const ACE = '00812999000011';
const BOLT = '00812999000028';
const KEYS = [`${ACE}#1`, `${ACE}#2`, BOLT];
const LABELS = {
  [`${ACE}#1`]: { model: 'Ace Hands-Free', size: 'Men 10.5 Wide' },
  [`${ACE}#2`]: { model: 'Ace Hands-Free', size: 'Men 10.5 Wide' },
  [BOLT]: { model: 'Bolt Runner', size: 'Women 8' },
};

const orderRow = (pending: string[]) =>
  ({ id: 'order-row', metadata: { batch_pending: pending, batch_keys: KEYS }, envelope: { shoe_labels: LABELS } }) as any;

const ctx = (row: any, target: string, encoding = 'fixed') => ({
  scheme: { version: 16, target_facet: 'upc', encoding },
  rule: { name: 'Shoe', notPrimed: {}, fallback: {} },
  parsed: { version: 16, category: '0', target },
  scannedAt: '2026-10-21T00:00:00Z',
  auth: { userId: 'maria' }, stationAuth: { userId: 'station-1' }, acting: true,
  subject: { row, code: '11:0:K7Q2M9XA', parsed: { target: 'K7Q2M9XA' }, scheme: { version: 11 } },
}) as any;

const step: ScanStep = {
  query: {}, verb: 'fill', subject: { schemes: [11] },
  refuse: { markdown: 'Not one of this order\'s shoes. Still to match: {fill.pending}.' },
  done: { markdown: 'Matched. Next: {fill.next}' },
  params: { fill: { into: 'subject', labels: 'envelope.shoe_labels', label: '{label.model}, {label.size} (UPC {code})' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimedByOther).mockResolvedValue(null);
  vi.mocked(spendGrant).mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
});

describe('fillStep with labels', () => {
  it('a refusal names the open entries by label, once each', async () => {
    const result = await fillStep(step, ctx(orderRow(KEYS), '00099999999999'));
    const ace = `Ace Hands-Free, Men 10.5 Wide (UPC ${ACE})`;
    const bolt = `Bolt Runner, Women 8 (UPC ${BOLT})`;
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.REFUSED);
    expect(result?.data?.refusal).toEqual({
      markdown: `Not one of this order's shoes. Still to match: ${ace}; ${bolt}.`,
      expected: [ace, bolt],
    });
  });

  it('prints a GTIN code as the package does', async () => {
    const result = await fillStep(step, ctx(orderRow([BOLT]), '00099999999999', 'gtin'));
    expect(result?.data?.refusal?.expected).toEqual(['Bolt Runner, Women 8 (UPC 0812999000028)']);
  });

  it('the done copy names the next open entry after this fill', async () => {
    fill.mockResolvedValue({ status: 200, data: { outcome: 'accepted', remaining: 1 } });
    const result = await fillStep(step, ctx(orderRow([`${ACE}#2`, BOLT]), ACE));
    expect(fill.mock.calls[0][0].itemKey).toBe(`${ACE}#2`);
    expect(result?.data?.done).toEqual({ markdown: `Matched. Next: Bolt Runner, Women 8 (UPC ${BOLT})` });
  });

  it('the done copy on the last fill has no next entry', async () => {
    fill.mockResolvedValue({ status: 200, data: { outcome: 'completed', remaining: 0 } });
    const result = await fillStep(step, ctx(orderRow([BOLT]), BOLT));
    expect(result?.data?.done).toEqual({ markdown: 'Matched. Next: ' });
  });

  it('{fill.next} names the first open code without labels', async () => {
    const plain: ScanStep = { ...step, refuse: { markdown: 'Next up: {fill.next}' }, params: { fill: { into: 'subject' } } };
    const result = await fillStep(plain, ctx(orderRow(KEYS), '00099999999999'));
    expect(result?.data?.refusal).toEqual({ markdown: `Next up: ${ACE}`, expected: [ACE, BOLT] });
  });
});

describe('entryLabeler', () => {
  const scheme = { encoding: 'fixed' } as any;

  it('is null without a labels map', () => {
    expect(entryLabeler({ into: 'subject' }, orderRow(KEYS), scheme)).toBeNull();
  });

  it('reads the map from an envelope stored as text', () => {
    const row = { metadata: {}, envelope: JSON.stringify({ names: { a: 'Left insole' } }) } as any;
    expect(entryLabeler({ into: 'subject', labels: 'envelope.names' }, row, scheme)!('a', 'a')).toBe('Left insole');
  });

  it('reads a text value as the label and falls back to the code', () => {
    const row = { metadata: {}, envelope: { names: { a: 'Left insole' } } } as any;
    const label = entryLabeler({ into: 'subject', labels: 'envelope.names' }, row, scheme)!;
    expect(label('a', 'a')).toBe('Left insole');
    expect(label('b', 'b')).toBe('b');
  });

  it('falls back to the code when the template renders empty', () => {
    const row = { metadata: {}, envelope: { names: { a: { other: 1 } } } } as any;
    const label = entryLabeler({ into: 'subject', labels: 'envelope.names', label: '{label.model}' }, row, scheme)!;
    expect(label('a', 'a-code')).toBe('a-code');
  });
});
