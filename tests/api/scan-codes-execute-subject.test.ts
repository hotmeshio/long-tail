import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/scan-code', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  listScanSchemes: vi.fn(),
  getScanRule: vi.fn(),
}));
vi.mock('../../api/scan-codes/subject', () => ({ resolveSubject: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ peekGrant: vi.fn(), settleGrant: vi.fn() }));
vi.mock('../../api/scan-codes/identity', () => ({ actingIdentitySatisfied: vi.fn(), executeIdentityScan: vi.fn() }));
vi.mock('../../api/scan-codes/hold', () => ({ holdStep: vi.fn() }));
vi.mock('../../api/scan-codes/verb-fill', () => ({ fillStep: vi.fn() }));
vi.mock('../../api/scan-codes/verbs', () => ({
  accumulateStep: vi.fn(), cancelStep: vi.fn(), claimStep: vi.fn(), escalateStep: vi.fn(), releaseStep: vi.fn(), resolveStep: vi.fn(),
}));

import * as scanCodeService from '../../services/scan-code';
import { resolveSubject } from '../../api/scan-codes/subject';
import { peekGrant, settleGrant } from '../../api/scan-codes/grant';
import { accumulateStep } from '../../api/scan-codes/verbs';
import { executeIdentityScan } from '../../api/scan-codes/identity';
import { executeScanCode } from '../../api/scan-codes/execute';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

const svc = vi.mocked(scanCodeService);
const subject = vi.mocked(resolveSubject);
const acc = vi.mocked(accumulateStep);

const TUB = {
  version: 14, name: 'Tub', description: null, target_facet: 'binCode', encoding: 'delimited', delimiter: ':',
  target_length: null, kind: 'action', grant_ttl_seconds: null, grant_max_uses: 0, grant_scope: 'action', enabled: true,
} as const;
const subjectStep: ScanStep = { query: {}, verb: 'accumulate', subject: { schemes: [11] }, params: { itemKey: 'x', accumulate: { from: 'subject' } } };
const legacyStep: ScanStep = { query: { availability: 'mine' }, verb: 'accumulate', params: { itemKey: '{claim.orderId}' } };
const station = { userId: 'station-1' };
const SUBJECT = { code: '11:0:K7Q2M9XA', escalationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const held = { row: { id: SUBJECT.escalationId }, scheme: { version: 11 }, parsed: {}, code: SUBJECT.code } as any;

beforeEach(() => {
  vi.clearAllMocks();
  svc.listScanSchemes.mockResolvedValue([TUB as any]);
  svc.getScanRule.mockResolvedValue({ scheme_version: 14, category: '0', name: 'Bin It', steps: [subjectStep, legacyStep], fallback: { markdown: 'none' }, notPrimed: {}, enabled: true });
  subject.mockResolvedValue(null);
  vi.mocked(settleGrant).mockResolvedValue(undefined);
  acc.mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.EXECUTED, verb: 'accumulate' } });
});

describe('executeScanCode — the held subject', () => {
  it('a subject step runs while a subject is held', async () => {
    subject.mockResolvedValue({ ok: true, subject: held });
    await executeScanCode({ code: '14:0:SF-A-2', subject: SUBJECT }, station);
    expect(acc.mock.calls[0][0]).toBe(subjectStep);
    expect(acc.mock.calls[0][1].subject).toBe(held);
  });

  it('without a subject the subject step is skipped and today\'s steps run', async () => {
    await executeScanCode({ code: '14:0:SF-A-2' }, station);
    expect(acc).toHaveBeenCalledTimes(1);
    expect(acc.mock.calls[0][0]).toBe(legacyStep);
  });

  it('a subject step asks for the badge itself, after it has checked the pairing', async () => {
    subject.mockResolvedValue({ ok: true, subject: held });
    svc.getScanRule.mockResolvedValue({
      scheme_version: 14, category: '0', name: 'Bin It', steps: [{ ...subjectStep, requireActingIdentity: true }],
      fallback: {}, notPrimed: {}, enabled: true,
    });
    await executeScanCode({ code: '14:0:SF-A-2', subject: SUBJECT }, station);
    expect(acc).toHaveBeenCalledTimes(1);
  });

  it('subject.facets branches on the held row: a non-matching step is skipped', async () => {
    subject.mockResolvedValue({ ok: true, subject: { ...held, row: { id: held.row.id, metadata: { binState: 'bound' } } } });
    const freeStep: ScanStep = { ...subjectStep, subject: { schemes: [11], facets: { binState: 'unbound' } } };
    const boundStep: ScanStep = { ...subjectStep, subject: { schemes: [11], facets: { binState: 'bound' } } };
    svc.getScanRule.mockResolvedValue({
      scheme_version: 14, category: '0', name: 'Bin It', steps: [freeStep, boundStep], fallback: {}, notPrimed: {}, enabled: true,
    });
    await executeScanCode({ code: '14:0:SF-A-2', subject: SUBJECT }, station);
    expect(acc).toHaveBeenCalledTimes(1);
    expect(acc.mock.calls[0][0]).toBe(boundStep);
  });

  it('a subject from another scheme does not open the gate', async () => {
    subject.mockResolvedValue({ ok: true, subject: { ...held, scheme: { version: 15 } } });
    await executeScanCode({ code: '14:0:SF-A-2', subject: SUBJECT }, station);
    expect(acc.mock.calls[0][0]).toBe(legacyStep);
  });

  it('a stale subject with nothing else matching answers subject_stale and clears it', async () => {
    subject.mockResolvedValue({ ok: false });
    acc.mockResolvedValue(null);
    const result = await executeScanCode({ code: '14:0:SF-A-2', subject: SUBJECT }, station);
    expect(result.data).toMatchObject({ outcome: SCAN_OUTCOMES.SUBJECT_STALE, clearSubject: true });
  });

  it('a stale subject never blocks a step that does not need one, but still clears', async () => {
    subject.mockResolvedValue({ ok: false });
    const result = await executeScanCode({ code: '14:0:SF-A-2', subject: SUBJECT }, station);
    expect(result.data).toMatchObject({ outcome: SCAN_OUTCOMES.EXECUTED, clearSubject: true });
  });
});

describe('executeScanCode — done copy on any writing step', () => {
  it('a step that writes carries its done copy; a step that falls through does not', async () => {
    svc.getScanRule.mockResolvedValue({
      scheme_version: 14, category: '0', name: 'Bin It',
      steps: [{ ...legacyStep, done: { markdown: 'Placed at {scan.target}.' } }], fallback: {}, notPrimed: {}, enabled: true,
    });
    const result = await executeScanCode({ code: '14:0:SF-A-2' }, station);
    expect(result.data?.done).toEqual({ markdown: 'Placed at SF-A-2.' });
  });
});

describe('executeScanCode — the badge', () => {
  it('a grant is peeked up front and settled after the walk', async () => {
    vi.mocked(peekGrant).mockResolvedValue({ ok: true, auth: { userId: 'maria' }, grant: { token: 't', peeked: { remaining: 1, bound: false }, spent: null } });
    vi.mocked(settleGrant).mockResolvedValue({ consumed: true, remaining: 0, bound: false });
    const result = await executeScanCode({ code: '14:0:SF-A-2', actingToken: 't' }, station);
    expect(acc.mock.calls[0][1].auth).toEqual({ userId: 'maria' });
    expect(result.data?.acting).toEqual({ consumed: true, remaining: 0, bound: false });
  });

  it('a dead grant is a replayable not-primed before any step runs', async () => {
    vi.mocked(peekGrant).mockResolvedValue({ ok: false, error: 'acting identity expired — scan your badge again' });
    const result = await executeScanCode({ code: '14:0:SF-A-2', actingToken: 't' }, station);
    expect(result.data).toMatchObject({ outcome: SCAN_OUTCOMES.NOT_PRIMED, replayable: true });
    expect(acc).not.toHaveBeenCalled();
  });
});

describe('executeScanCode — the badge policy belongs to the station', () => {
  it('a badge scan hands the device and its locked role to the mint', async () => {
    svc.listScanSchemes.mockResolvedValue([{ ...TUB, version: 12, kind: 'identity', target_facet: 'badge_id' } as any]);
    svc.getScanRule.mockResolvedValue({ scheme_version: 12, category: '0', name: 'Badge in', steps: [], fallback: {}, notPrimed: {}, enabled: true });
    vi.mocked(executeIdentityScan).mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.IDENTITY_PRIMED } });
    await executeScanCode({ code: '12:0:HB-1', stationRole: 'binning-associate' }, station);
    expect(vi.mocked(executeIdentityScan).mock.calls[0][4]).toEqual({ userId: 'station-1', stationRole: 'binning-associate' });
  });
});

