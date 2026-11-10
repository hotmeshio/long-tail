import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/identifiers', async (importActual) => {
  const actual = await importActual<typeof import('../../services/identifiers')>();
  return { ...actual, bindingScheme: vi.fn(), mayBind: vi.fn(), bind: vi.fn() };
});
vi.mock('../../api/scan-codes/subject', () => ({ claimedByOther: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ spendGrant: vi.fn(), identityGate: vi.fn() }));

import * as identifiers from '../../services/identifiers';
import { claimedByOther } from '../../api/scan-codes/subject';
import { identityGate, spendGrant } from '../../api/scan-codes/grant';
import { bindStep } from '../../api/scan-codes/verb-bind';
import { assertValidSteps } from '../../services/scan-code/validate';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const bind = vi.mocked(identifiers.bind);
const SWAP = { id: 'swap-row', role: 'print-servicer', metadata: { serialNumber: 'P1S-01', machineSlug: 'p1s-a' } };
const ctx = (target = 'PLATE-9', subject: any = { row: SWAP, scheme: { version: 21, target_facet: 'serialNumber' } }) => ({
  scheme: { version: 22, target_facet: 'plateCode' },
  rule: { name: 'Plate', notPrimed: {}, fallback: {} },
  parsed: { version: 22, category: '0', target },
  scannedAt: '2026-11-09T00:00:00Z',
  auth: { userId: 'maria' }, stationAuth: { userId: 'station-1' }, acting: true,
  subject,
}) as any;
const step = (over: Partial<ScanStep> = {}): ScanStep => ({ query: {}, verb: 'bind', subject: { schemes: [21] }, ...over } as ScanStep);
const BINDING = { id: '7', scheme_version: 22, raw: 'PLATE-9', target: 'P1S-01' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identifiers.bindingScheme).mockResolvedValue({ version: 22, name: 'Plates', identifier: { exclusiveTarget: true } } as any);
  vi.mocked(identifiers.mayBind).mockResolvedValue(true);
  vi.mocked(claimedByOther).mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
  vi.mocked(spendGrant).mockResolvedValue(null);
  bind.mockResolvedValue({ binding: BINDING, already: false, retired: [] } as any);
});

describe('bind step', () => {
  it('binds the scanned value to the held subject\'s target, under the scanned scheme, as a scan', async () => {
    const result = await bindStep(step(), ctx());
    expect(bind).toHaveBeenCalledWith(22, 'PLATE-9', 'P1S-01', { userId: 'maria', via: 'scan' });
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, verb: 'bind', binding: BINDING, clearSubject: false });
    expect(spendGrant).toHaveBeenCalled();
  });

  it('a step may name the scheme and the subject facet', async () => {
    await bindStep(step({ params: { bind: { scheme: 30, facet: 'machineSlug' } } }), ctx());
    expect(identifiers.bindingScheme).toHaveBeenCalledWith(30);
    expect(bind).toHaveBeenCalledWith(22, 'PLATE-9', 'p1s-a', expect.anything());
  });

  it('a value bound to something else is refused, and the subject is kept', async () => {
    bind.mockRejectedValue(new identifiers.BindingError(409, 'this value is already bound under scheme 22'));
    const result = await bindStep(step(), ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, clearSubject: false });
    expect(result?.data?.error).toMatch(/already bound/);
  });

  it('the same pair again answers already', async () => {
    bind.mockResolvedValue({ binding: BINDING, already: true, retired: [] } as any);
    expect((await bindStep(step(), ctx()))?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, already: true });
  });

  it('a caller who may not bind is refused before the badge is spent', async () => {
    vi.mocked(identifiers.mayBind).mockResolvedValue(false);
    expect((await bindStep(step(), ctx()))?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED });
    expect(spendGrant).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it('a held row without the target facet is refused, and no subject falls through', async () => {
    const bare = { row: { id: 'r', role: 'x', metadata: {} }, scheme: { version: 21, target_facet: 'serialNumber' } };
    expect((await bindStep(step(), ctx('PLATE-9', bare)))?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED });
    expect(await bindStep(step(), ctx('PLATE-9', null))).toBeNull();
    expect(bind).not.toHaveBeenCalled();
  });
});

describe('bind step validation', () => {
  it('needs a subject gate', () => {
    expect(() => assertValidSteps([{ query: {}, verb: 'bind' } as ScanStep])).toThrow(/subject gate/);
    expect(() => assertValidSteps([step()])).not.toThrow();
  });

  it('checks its params, and params.bind belongs to bind steps only', () => {
    expect(() => assertValidSteps([step({ params: { bind: { scheme: 7 } } })])).toThrow(/params.bind.scheme/);
    expect(() => assertValidSteps([step({ params: { bind: { facet: 'not a key' } } })])).toThrow(/params.bind.facet/);
    expect(() => assertValidSteps([{ query: {}, verb: 'claim', params: { bind: {} } } as ScanStep])).toThrow(/params.bind applies only/);
  });

  it('cannot be a choice verb', () => {
    const present = { query: {}, verb: 'present', choices: [{ label: 'Bind', verb: 'bind' }] } as ScanStep;
    expect(() => assertValidSteps([present])).toThrow(/cannot be a choice verb/);
  });
});
