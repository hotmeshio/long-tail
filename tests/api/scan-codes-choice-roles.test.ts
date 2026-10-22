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
import { peekGrant } from '../../api/scan-codes/grant';
import { locateForStep } from '../../api/scan-codes/locate';
import { dispatchChoiceVerb } from '../../api/scan-codes/verbs';
import { executeScanChoice } from '../../api/scan-codes/choice';
import { presentStep } from '../../api/scan-codes/present';
import { SCAN_OUTCOMES } from '../../types';

const station = { userId: 'station-1' } as any;
const pointer = { schemeVersion: 10, category: '4', stepIndex: 0, choiceIndex: 0, escalationId: 'esc-1' };
const keyIn = { label: 'Add without scan', verb: 'resolve', params: { resolverPayload: { by: 'manager' } }, roles: ['manager'], refuse: "A manager's badge is needed." };
const step = { query: { roles: ['packing'] }, verb: 'present', choices: [keyIn] } as any;
const rule = { scheme_version: 10, category: '4', name: 'Bag', enabled: true, notPrimed: { markdown: 'badge' }, steps: [step] } as any;
const row = { id: 'esc-1', metadata: { serialNumber: 'SER-9' } } as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scanCodeService.getScanScheme).mockResolvedValue({ version: 10, enabled: true, kind: 'action', target_facet: 'serialNumber' } as any);
  vi.mocked(scanCodeService.getScanRule).mockResolvedValue(rule);
  vi.mocked(escalationService.getEscalation).mockResolvedValue(row);
  vi.mocked(actingIdentitySatisfied).mockResolvedValue(true);
  vi.mocked(locateForStep).mockResolvedValue({ escalations: [row], total: 1 });
  vi.mocked(dispatchChoiceVerb).mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, escalation: row } } as any);
  vi.mocked(userService.getUserRoles).mockResolvedValue([{ role: 'packer' }] as any);
  vi.mocked(userService.isSuperAdmin).mockResolvedValue(false);
});

describe('executeScanChoice with roles', () => {
  it('parks for a badge when the station holds no grant, naming the need', async () => {
    const result = await executeScanChoice(pointer, station);
    expect(result.data).toMatchObject({ outcome: SCAN_OUTCOMES.NOT_PRIMED, replayable: true, error: "A manager's badge is needed." });
    expect(escalationService.getEscalation).not.toHaveBeenCalled();
    expect(dispatchChoiceVerb).not.toHaveBeenCalled();
  });

  it('refuses a badge without the role before reading the row', async () => {
    vi.mocked(peekGrant).mockResolvedValue({ ok: true, auth: { userId: 'u-packer' }, grant: {} } as any);
    const result = await executeScanChoice({ ...pointer, actingToken: 'eph:t' }, station);
    expect(result.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, refusal: { markdown: "A manager's badge is needed." } });
    expect(userService.getUserRoles).toHaveBeenCalledWith('u-packer');
    expect(dispatchChoiceVerb).not.toHaveBeenCalled();
  });

  it('runs for a badge with the role', async () => {
    vi.mocked(peekGrant).mockResolvedValue({ ok: true, auth: { userId: 'u-mgr' }, grant: {} } as any);
    vi.mocked(userService.getUserRoles).mockResolvedValue([{ role: 'manager' }] as any);
    const result = await executeScanChoice({ ...pointer, actingToken: 'eph:t' }, station);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.EXECUTED);
    expect(vi.mocked(dispatchChoiceVerb).mock.calls[0][1].auth).toEqual({ userId: 'u-mgr' });
  });
});

describe('presentStep with roles', () => {
  const ctx = {
    scheme: { target_facet: 'serialNumber' }, rule: { notPrimed: { markdown: 'badge' } },
    parsed: { version: 10, category: '4', target: 'SER-9' },
    auth: { userId: 'station-1' }, stationAuth: { userId: 'station-1' }, acting: false,
  } as any;

  it('withholds a choice from a person without its role and names the roles', async () => {
    const result = await presentStep({ ...step, choices: [keyIn, { label: 'Show', verb: 'show-detail' }] }, ctx);
    expect(result?.data?.choices).toMatchObject([
      { label: 'Add without scan', roles: ['manager'], withheld: true },
      { label: 'Show', withheld: false },
    ]);
  });

  it('never auto-selects a single choice the person cannot run', async () => {
    const result = await presentStep({ ...step, autoSelectSingle: true }, ctx);
    expect(result?.data?.outcome).toBe(SCAN_OUTCOMES.CHOICES);
    expect(dispatchChoiceVerb).not.toHaveBeenCalled();
  });

  it('offers it to a person holding the role', async () => {
    vi.mocked(userService.getUserRoles).mockResolvedValue([{ role: 'manager' }] as any);
    const result = await presentStep(step, ctx);
    expect(result?.data?.choices?.[0].withheld).toBe(false);
  });
});
