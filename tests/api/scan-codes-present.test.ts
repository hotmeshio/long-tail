import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/scan-codes/identity', () => ({
  actingIdentitySatisfied: vi.fn(),
}));
vi.mock('../../api/scan-codes/locate', () => ({
  locateForStep: vi.fn(),
}));
vi.mock('../../api/scan-codes/verbs', () => ({
  dispatchChoiceVerb: vi.fn(),
}));

import { actingIdentitySatisfied } from '../../api/scan-codes/identity';
import { locateForStep } from '../../api/scan-codes/locate';
import { dispatchChoiceVerb } from '../../api/scan-codes/verbs';
import { presentStep } from '../../api/scan-codes/present';
import { SCAN_OUTCOMES } from '../../types';
import type { ScanStep } from '../../types';

const satisfied = vi.mocked(actingIdentitySatisfied);
const locate = vi.mocked(locateForStep);
const dispatch = vi.mocked(dispatchChoiceVerb);

const row = { id: 'esc-1', metadata: { serialNumber: 'SER-9' } } as any;
const ctx = {
  scheme: { target_facet: 'serialNumber' },
  rule: { notPrimed: { markdown: 'badge in' } },
  parsed: { version: 10, category: '5', target: 'SER-9' },
  auth: { userId: 'u1' }, stationAuth: { userId: 'u1' }, acting: false,
} as any;

const single = (over: Partial<ScanStep> = {}): ScanStep => ({
  query: { roles: ['line-a'] },
  verb: 'present',
  autoSelectSingle: true,
  choices: [{ label: 'Claim & Work', verb: 'claim-show-detail', requireActingIdentity: true }],
  ...over,
} as ScanStep);

beforeEach(() => {
  vi.clearAllMocks();
  locate.mockResolvedValue({ escalations: [row], total: 1 });
  dispatch.mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, escalation: row } } as any);
});

describe('presentStep — auto-select', () => {
  it('a single confirm-less choice executes directly when the identity is satisfied', async () => {
    satisfied.mockResolvedValue(true);
    const result = await presentStep(single(), ctx);
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    const [step] = dispatch.mock.calls[0];
    expect(step.verb).toBe('claim-show-detail');
    expect(step.query).toEqual({ roles: ['line-a'] });
  });

  it('an unsatisfied identity presents instead — with the autoSelect flag for the stop-over', async () => {
    satisfied.mockResolvedValue(false);
    const result = await presentStep(single(), ctx);
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.CHOICES);
    expect(result?.data?.autoSelect).toBe(true);
    expect(result?.data?.choices?.[0].withheld).toBe(true);
    expect(result?.data?.notPrimed).toEqual({ markdown: 'badge in' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('multiple choices always present — autoSelect never guesses', async () => {
    satisfied.mockResolvedValue(true);
    const result = await presentStep(single({
      choices: [
        { label: 'A', verb: 'claim' },
        { label: 'B', verb: 'release' },
      ],
    }), ctx);
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.CHOICES);
    expect(result?.data?.autoSelect).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a locate miss falls through (null) so the next step can answer', async () => {
    locate.mockResolvedValue({ escalations: [], total: 0 });
    expect(await presentStep(single(), ctx)).toBeNull();
  });
});

describe('presentStep — curated facts', () => {
  const twoChoices = (facts?: ScanStep['facts']) => single({
    autoSelectSingle: false, facts,
    choices: [{ label: 'Start', verb: 'claim' }, { label: 'View', verb: 'show-detail' }],
  });

  it('renders each fact against the presented row and the scan, in order', async () => {
    satisfied.mockResolvedValue(true);
    const result = await presentStep(twoChoices([
      { label: 'Serial', value: '{item.serialNumber}' },
      { label: 'Scanned', value: '{scan.target}' },
    ]), ctx);
    expect(result?.data?.facts).toEqual([{ label: 'Serial', value: 'SER-9' }, { label: 'Scanned', value: 'SER-9' }]);
  });

  it('a fact whose facet the row lacks renders empty, never the raw token', async () => {
    satisfied.mockResolvedValue(true);
    const result = await presentStep(twoChoices([{ label: 'Table', value: '{item.packingTable}' }]), ctx);
    expect(result?.data?.facts).toEqual([{ label: 'Table', value: '' }]);
  });

  it('a step without facts answers without them, so the station lists metadata as before', async () => {
    satisfied.mockResolvedValue(true);
    expect(await presentStep(twoChoices(), ctx).then((r) => r?.data && 'facts' in r.data)).toBe(false);
  });
});
