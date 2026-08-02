import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/scan-code', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getScanScheme: vi.fn(),
  getScanRule: vi.fn(),
}));
vi.mock('../../services/escalation', () => ({
  getEscalation: vi.fn(),
}));
vi.mock('../../api/scan-codes/identity', () => ({
  actingIdentitySatisfied: vi.fn(),
  resolveActingAuth: vi.fn(),
}));
vi.mock('../../api/scan-codes/locate', () => ({
  locateForStep: vi.fn(),
}));
vi.mock('../../api/scan-codes/verbs', () => ({
  dispatchChoiceVerb: vi.fn(),
}));

import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { actingIdentitySatisfied, resolveActingAuth } from '../../api/scan-codes/identity';
import { locateForStep } from '../../api/scan-codes/locate';
import { dispatchChoiceVerb } from '../../api/scan-codes/verbs';
import { executeScanChoice } from '../../api/scan-codes/choice';
import { SCAN_OUTCOMES } from '../../types';

const svc = vi.mocked(scanCodeService);
const esc = vi.mocked(escalationService);
const satisfied = vi.mocked(actingIdentitySatisfied);
const acting = vi.mocked(resolveActingAuth);
const claim = vi.mocked(dispatchChoiceVerb);
const locate = vi.mocked(locateForStep);

const auth = { userId: 'station-1' } as any;
const pointer = {
  schemeVersion: 10, category: '4', stepIndex: 0, choiceIndex: 0, escalationId: 'esc-1',
};
const scheme = { version: 10, enabled: true, kind: 'action', target_facet: 'serialNumber' } as any;
const rule = {
  scheme_version: 10, category: '4', name: 'Work Item', enabled: true, notPrimed: { markdown: 'badge' },
  steps: [{
    query: { roles: ['line-a'] }, verb: 'present',
    choices: [{ label: 'Claim', verb: 'claim', requireActingIdentity: true }],
  }],
} as any;
const row = { id: 'esc-1', metadata: { serialNumber: 'SER-9' } } as any;

beforeEach(() => {
  vi.clearAllMocks();
  svc.getScanScheme.mockResolvedValue(scheme);
  svc.getScanRule.mockResolvedValue(rule);
  esc.getEscalation.mockResolvedValue(row);
  satisfied.mockResolvedValue(true);
  locate.mockResolvedValue({ escalations: [row], total: 1 });
  claim.mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, escalation: row } } as any);
});

describe('executeScanChoice — the pointer is never authority', () => {
  it('re-reads live config and dispatches the choice verb', async () => {
    const result = await executeScanChoice(pointer, auth);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    // The synthesized step carries the PARENT query and the CHOICE verb.
    const [step, ctx, row2] = claim.mock.calls[0];
    expect(step.query).toEqual({ roles: ['line-a'] });
    expect(step.verb).toBe('claim');
    expect(ctx.parsed).toEqual({ version: 10, category: '4', target: 'SER-9' });
    expect(row2.id).toBe('esc-1');
  });

  it('a stale pointer (config edited away) is UNCONFIGURED', async () => {
    svc.getScanRule.mockResolvedValue({ ...rule, steps: [] });
    const result = await executeScanChoice(pointer, auth);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.UNCONFIGURED);
    expect(claim).not.toHaveBeenCalled();
  });

  it('a row missing the scheme facet is UNCONFIGURED — fail loud, never guess the target', async () => {
    esc.getEscalation.mockResolvedValue({ id: 'esc-1', metadata: {} } as any);
    const result = await executeScanChoice(pointer, auth);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.UNCONFIGURED);
  });

  it('a row that moved out of the presented state is CONFLICT', async () => {
    locate.mockResolvedValue({ escalations: [{ id: 'other' }] as any, total: 1 });
    const result = await executeScanChoice(pointer, auth);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.CONFLICT);
    expect(claim).not.toHaveBeenCalled();
  });

  it('the identity gate re-applies: unsatisfied requirement is NOT_PRIMED', async () => {
    satisfied.mockResolvedValue(false);
    const result = await executeScanChoice(pointer, auth);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.NOT_PRIMED);
    expect(result.data?.notPrimed).toEqual({ markdown: 'badge' });
  });

  it('a dead acting grant terminates before any read or write', async () => {
    acting.mockResolvedValue({ ok: false, error: 'expired' });
    const result = await executeScanChoice({ ...pointer, actingToken: 'eph:v1:acting_identity:x' }, auth);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.NOT_PRIMED);
    expect(esc.getEscalation).not.toHaveBeenCalled();
  });

  it('a live grant swaps the effective actor for the dispatch', async () => {
    acting.mockResolvedValue({ ok: true, auth: { userId: 'person-1' } });
    await executeScanChoice({ ...pointer, actingToken: 'eph:v1:acting_identity:x' }, auth);
    const [, ctx] = claim.mock.calls[0];
    expect(ctx.auth.userId).toBe('person-1');
    expect(ctx.stationAuth.userId).toBe('station-1');
    expect(ctx.acting).toBe(true);
  });
});
