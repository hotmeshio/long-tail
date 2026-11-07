import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/scan-codes/identity', () => ({ actingIdentitySatisfied: vi.fn() }));
vi.mock('../../api/scan-codes/locate', () => ({ locateForStep: vi.fn() }));
vi.mock('../../api/scan-codes/verbs', () => ({ dispatchChoiceVerb: vi.fn() }));
vi.mock('../../api/scan-codes/choice-roles', () => ({ holdsChoiceRole: vi.fn(async () => true) }));

import { actingIdentitySatisfied } from '../../api/scan-codes/identity';
import { locateForStep } from '../../api/scan-codes/locate';
import { presentStep } from '../../api/scan-codes/present';
import { withDone } from '../../api/scan-codes/context';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

// What the station shows around an act: the done copy's pause and next
// prompt, and a present step's roster.

const row = { id: 'tub-row', metadata: { tubCode: 'T-1' } } as any;
const ctx = {
  scheme: { target_facet: 'tubCode' },
  rule: { notPrimed: {} },
  parsed: { version: 15, category: '1', target: 'T-1' },
  auth: { userId: 'u1' }, stationAuth: { userId: 'u1' }, acting: false,
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actingIdentitySatisfied).mockResolvedValue(true);
  vi.mocked(locateForStep).mockResolvedValue({ escalations: [row], total: 1 });
});

describe('withDone', () => {
  it('renders the copy and its next prompt, and carries the pause', () => {
    const result = withDone(
      { status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED } },
      { done: { markdown: 'Bag **{scan.target}** is in.', afterSeconds: 5, nextPrompt: 'Drop it in **{scan.target}**' } },
      { target: 'A3', category: '0', scannedAt: 'now' },
    );
    expect(result.data?.done).toEqual({ markdown: 'Bag **A3** is in.', afterSeconds: 5, nextPrompt: 'Drop it in **A3**' });
  });

  it('copy without a pause or prompt stays as it was', () => {
    const result = withDone({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED } }, { done: { markdown: 'Done.' } }, { target: 'x', category: '0', scannedAt: 'now' });
    expect(result.data?.done).toEqual({ markdown: 'Done.' });
  });
});

describe('present show', () => {
  it('names the roster to show above the choices', async () => {
    const step: ScanStep = {
      query: { roles: ['transfer'] }, verb: 'present', show: 'tubRoster',
      choices: [{ label: 'Arrive', verb: 'resolve', params: { resolverPayload: { arrived: true } } }],
    };
    const result = await presentStep(step, ctx);
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.CHOICES, show: 'tubRoster' });
  });
});
