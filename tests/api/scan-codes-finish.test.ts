import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/scan-code', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getScanScheme: vi.fn(),
  getScanRule: vi.fn(),
}));
vi.mock('../../services/escalation', () => ({ getEscalation: vi.fn() }));
vi.mock('../../services/user', () => ({ getUserRoles: vi.fn(), isSuperAdmin: vi.fn() }));
vi.mock('../../api/scan-codes/identity', () => ({ actingIdentitySatisfied: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ peekGrant: vi.fn(), settleGrant: vi.fn() }));
vi.mock('../../api/scan-codes/locate', () => ({ locateForStep: vi.fn() }));
vi.mock('../../api/scan-codes/verbs', () => ({ dispatchChoiceVerb: vi.fn() }));
vi.mock('../../api/escalations/helpers', () => ({ assertReadAccess: vi.fn(async () => null) }));

import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { actingIdentitySatisfied } from '../../api/scan-codes/identity';
import { locateForStep } from '../../api/scan-codes/locate';
import { dispatchChoiceVerb } from '../../api/scan-codes/verbs';
import { executeScanChoice } from '../../api/scan-codes/choice';
import { presentStep } from '../../api/scan-codes/present';
import { withFollow } from '../../api/scan-codes/context';
import { SCAN_OUTCOMES } from '../../types';

const station = { userId: 'station-1' } as any;
const pointer = { schemeVersion: 10, category: '4', stepIndex: 0, choiceIndex: 0, escalationId: 'esc-1' };
const arrived = {
  label: 'Arrived: move the orders', verb: 'resolve', params: { resolverPayload: { outcome: 'arrived' } },
  done: { markdown: 'Moved **{item.memberCount}** orders to Matching.' },
};
const openTub = { label: 'Open the tub', verb: 'show-detail', roles: ['manager'], hidden: true };
const sendBack = { label: 'Send back', verb: 'cancel', when: { lane: 'north' } };
const step = { query: { roles: ['moving-tub'] }, verb: 'present', choices: [arrived, openTub, sendBack] } as any;
const rule = { scheme_version: 10, category: '4', name: 'Tub', enabled: true, notPrimed: { markdown: 'badge' }, steps: [step] } as any;
const row = { id: 'esc-1', metadata: { serialNumber: 'TUB-9', memberCount: 12, lane: 'south' } } as any;
const ctx = {
  scheme: { target_facet: 'serialNumber' }, rule,
  parsed: { version: 10, category: '4', target: 'TUB-9' },
  auth: { userId: 'u1' }, stationAuth: { userId: 'u1' }, acting: false,
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scanCodeService.getScanScheme).mockResolvedValue({ version: 10, enabled: true, kind: 'action', target_facet: 'serialNumber' } as any);
  vi.mocked(scanCodeService.getScanRule).mockResolvedValue(rule);
  vi.mocked(escalationService.getEscalation).mockResolvedValue(row);
  vi.mocked(actingIdentitySatisfied).mockResolvedValue(true);
  vi.mocked(locateForStep).mockResolvedValue({ escalations: [row], total: 1 });
  vi.mocked(dispatchChoiceVerb).mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, escalation: row } } as any);
  vi.mocked(userService.getUserRoles).mockResolvedValue([{ role: 'mover' }] as any);
  vi.mocked(userService.isSuperAdmin).mockResolvedValue(false);
});

describe('presentStep — what the screen offers', () => {
  it('leaves a hidden choice off for a person without its roles, and a choice the row does not offer', async () => {
    const result = await presentStep(step, ctx);
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.CHOICES);
    expect(result?.data?.choices?.map((c) => c.label)).toEqual(['Arrived: move the orders']);
  });

  it('shows the hidden choice to a person holding its role, at its config index', async () => {
    vi.mocked(userService.getUserRoles).mockResolvedValue([{ role: 'manager' }] as any);
    const result = await presentStep(step, ctx);
    expect(result?.data?.choices?.map((c) => [c.index, c.label])).toEqual([[0, 'Arrived: move the orders'], [1, 'Open the tub']]);
  });

  it('offers a when-gated choice once the row carries the facet', async () => {
    vi.mocked(locateForStep).mockResolvedValue({ escalations: [{ ...row, metadata: { ...row.metadata, lane: 'north' } }], total: 1 });
    const result = await presentStep(step, ctx);
    expect(result?.data?.choices?.map((c) => c.label)).toContain('Send back');
  });
});

describe('executeScanChoice — done copy and when', () => {
  it('an executed choice carries its done copy, rendered over the row', async () => {
    const result = await executeScanChoice(pointer, station);
    expect(result.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, done: { markdown: 'Moved **12** orders to Matching.' } });
  });

  it('a choice the row no longer offers answers conflict, nothing written', async () => {
    const result = await executeScanChoice({ ...pointer, choiceIndex: 2 }, station);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.CONFLICT);
    expect(dispatchChoiceVerb).not.toHaveBeenCalled();
  });
});

describe('withFollow', () => {
  const held = { code: '11:0:K7Q2M9XA', parsed: { version: 11, category: '0', target: 'K7Q2M9XA' }, scheme: { target_facet: 'orderId' } };
  const fillStep = { follow: { roles: ['binning-associate'], waitSeconds: 15 } } as any;
  const executed = (over: Record<string, unknown>) => ({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, ...over } } as any);

  it('a write that completes the subject names the code to replay and the target to wait for', () => {
    const result = withFollow(executed({ clearSubject: true }), fillStep, { subject: held } as any);
    expect(result.data?.follow).toEqual({
      code: '11:0:K7Q2M9XA', roles: ['binning-associate'], waitSeconds: 15, target: { facet: 'orderId', value: 'K7Q2M9XA' },
    });
  });

  it('defaults the wait, and stays silent while the subject is still held or no subject rode the scan', () => {
    const result = withFollow(executed({ clearSubject: true }), { follow: { roles: ['x'] } } as any, { subject: held } as any);
    expect(result.data?.follow?.waitSeconds).toBe(10);
    expect(withFollow(executed({ progress: { remaining: 2 } }), fillStep, { subject: held } as any).data?.follow).toBeUndefined();
    expect(withFollow(executed({ clearSubject: true }), fillStep, {} as any).data?.follow).toBeUndefined();
    expect(withFollow(executed({ clearSubject: true }), {} as any, { subject: held } as any).data?.follow).toBeUndefined();
  });
});
