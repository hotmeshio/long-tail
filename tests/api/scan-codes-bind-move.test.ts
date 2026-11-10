import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/identifiers', async (importActual) => {
  const actual = await importActual<typeof import('../../services/identifiers')>();
  return { ...actual, bindingScheme: vi.fn(), mayBind: vi.fn(), bind: vi.fn(), rebind: vi.fn() };
});
vi.mock('../../api/escalations/metadata', async (importActual) => {
  const actual = await importActual<typeof import('../../api/escalations/metadata')>();
  return { ...actual, resolveByMetadata: vi.fn() };
});
vi.mock('../../api/scan-codes/subject', () => ({ claimedByOther: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ spendGrant: vi.fn(), identityGate: vi.fn() }));

import * as identifiers from '../../services/identifiers';
import { resolveByMetadata } from '../../api/escalations/metadata';
import { claimedByOther } from '../../api/scan-codes/subject';
import { identityGate, spendGrant } from '../../api/scan-codes/grant';
import { bindStep } from '../../api/scan-codes/verb-bind';
import { assertValidSteps } from '../../services/scan-code/validate';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const bind = vi.mocked(identifiers.bind);
const rebind = vi.mocked(identifiers.rebind);
const resolve = vi.mocked(resolveByMetadata);
const SWAP = { id: '6f1c2e9a-0d3b-4c55-9a51-1b2c3d4e5f60', role: 'print-servicer', metadata: { serialNumber: 'P1S-02' } };
const HELD = { row: SWAP, scheme: { version: 21, target_facet: 'serialNumber' }, parsed: { version: 21, category: '0', target: 'P1S-02' } };
const ctx = (subject: any = HELD) => ({
  scheme: { version: 22, target_facet: 'plateCode' },
  rule: { name: 'Plate', notPrimed: {}, fallback: {} },
  parsed: { version: 22, category: '0', target: 'PLATE-9' },
  scannedAt: '2026-11-10T00:00:00Z',
  auth: { userId: 'maria' }, stationAuth: { userId: 'station-1' }, acting: true,
  subject,
}) as any;
const step = (bindParams: Record<string, unknown>): ScanStep => ({ query: {}, verb: 'bind', subject: { schemes: [21] }, params: { bind: bindParams } } as ScanStep);
const MOVED = { id: '8', scheme_version: 22, raw: 'PLATE-9', target: 'P1S-02' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identifiers.bindingScheme).mockResolvedValue({ version: 22, name: 'Plates', identifier: { exclusiveTarget: true } } as any);
  vi.mocked(identifiers.mayBind).mockResolvedValue(true);
  vi.mocked(claimedByOther).mockResolvedValue(null);
  vi.mocked(identityGate).mockResolvedValue(null);
  vi.mocked(spendGrant).mockResolvedValue(null);
  rebind.mockResolvedValue({ binding: MOVED, already: false, retired: [{ id: '7' }] } as any);
  resolve.mockResolvedValue({ status: 200, data: { escalation: { id: SWAP.id, role: SWAP.role, status: 'resolved' } } });
});

describe('bind step: move', () => {
  it('moves a value bound elsewhere onto the held row\'s target through rebind', async () => {
    const result = await bindStep(step({ move: true }), ctx());
    expect(rebind).toHaveBeenCalledWith(22, 'PLATE-9', 'P1S-02', { userId: 'maria', via: 'scan' });
    expect(bind).not.toHaveBeenCalled();
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, binding: MOVED, clearSubject: false });
  });

  it('without move a value bound elsewhere is refused and nothing is resolved', async () => {
    bind.mockRejectedValue(new identifiers.BindingError(409, 'this value is already bound under scheme 22'));
    const result = await bindStep(step({ resolve: { payload: { plateId: '{scan.target}' } } }), ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, clearSubject: false });
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('bind step: resolve', () => {
  it('resolves the held row by id with the rendered payload, then releases it', async () => {
    const result = await bindStep(step({ move: true, resolve: { payload: { plateId: '{scan.target}', printer: '{subject.serialNumber}' } } }), ctx());
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      key: 'serialNumber', value: 'P1S-02', assertId: SWAP.id,
      resolverPayload: { plateId: 'PLATE-9', printer: 'P1S-02' },
    }), { userId: 'maria' });
    expect(rebind.mock.invocationCallOrder[0]).toBeLessThan(resolve.mock.invocationCallOrder[0]);
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, binding: MOVED, escalation: { id: SWAP.id, status: 'resolved' }, clearSubject: true });
  });

  it('a held row that already ended keeps the binding and releases the subject', async () => {
    resolve.mockResolvedValue({ status: 404, error: 'No pending escalation found' });
    const result = await bindStep(step({ move: true, resolve: {} }), ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, binding: MOVED, clearSubject: true });
  });

  it('a payload the role refuses answers refused, naming the binding that stands', async () => {
    resolve.mockResolvedValue({ status: 422, error: 'plateId is required' });
    const result = await bindStep(step({ move: true, resolve: {} }), ctx());
    expect(result?.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, binding: MOVED, clearSubject: false });
  });

  it('a template with nothing to read falls through before anything is written', async () => {
    expect(await bindStep(step({ move: true, resolve: { payload: { lot: '{claim.lot}' } } }), ctx())).toBeNull();
    expect(spendGrant).not.toHaveBeenCalled();
    expect(rebind).not.toHaveBeenCalled();
  });
});

describe('bind step validation: move and resolve', () => {
  it('accepts a boolean move and a resolve with a payload object', () => {
    expect(() => assertValidSteps([step({ move: true, resolve: { payload: { a: 1 } } })])).not.toThrow();
    expect(() => assertValidSteps([step({ resolve: {} })])).not.toThrow();
  });

  it('refuses other shapes', () => {
    expect(() => assertValidSteps([step({ move: 'yes' })])).toThrow(/params.bind.move/);
    expect(() => assertValidSteps([step({ resolve: true })])).toThrow(/params.bind.resolve must be an object/);
    expect(() => assertValidSteps([step({ resolve: { payload: [] } })])).toThrow(/params.bind.resolve.payload/);
    expect(() => assertValidSteps([step({ resolve: { then: 1 } })])).toThrow(/takes payload/);
  });
});
