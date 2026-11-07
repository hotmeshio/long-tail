import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation', () => ({ getEscalationWithFormSchema: vi.fn() }));
vi.mock('../../services/escalation/roster', () => ({ loadRoster: vi.fn() }));
vi.mock('../../services/scan-code', async (io) => ({
  ...(await io<typeof import('../../services/scan-code')>()),
  listScanSchemes: vi.fn(),
}));
vi.mock('../../services/iam/acting-identity', () => ({
  peekActingAuth: vi.fn(), consumeActingGrant: vi.fn(), refundActingGrant: vi.fn(),
}));
vi.mock('../../api/escalations/helpers', () => ({ assertReadAccess: vi.fn() }));
vi.mock('../../api/escalations/resolve-batch', () => ({ resolveBatchItem: vi.fn() }));

import * as escalationService from '../../services/escalation';
import { loadRoster } from '../../services/escalation/roster';
import * as scanCodeService from '../../services/scan-code';
import * as acting from '../../services/iam/acting-identity';
import { assertReadAccess } from '../../api/escalations/helpers';
import { resolveBatchItem } from '../../api/escalations/resolve-batch';
import { runRosterScan } from '../../api/escalations/roster-scan';

// A batch roster with x-lt-scan takes scans on the open form: the server
// fills the first open entry whose key is the scanned code.

const station = { userId: 'station-1' };
const ITEM = '00812999000011';
const SCHEMES = [
  { version: 16, name: 'Item', target_facet: 'upc', encoding: 'gtin', delimiter: ':', target_length: null, patterns: [], precedes_gtin: null, target_match: 'value', kind: 'action', grant_ttl_seconds: null, grant_max_uses: 0, grant_scope: 'action', enabled: true },
];
const roster = (scan: unknown = { schemes: [16] }) => ({
  properties: { items: { 'x-lt-widget': 'roster', 'x-lt-roster': { expected: { batch: true } }, ...(scan ? { 'x-lt-scan': scan } : {}) } },
});
const host = { id: 'pick-1', role: 'picking', metadata: {}, envelope: '{}' };
const entries = (states: string[]) => states.map((state, i) => ({ key: `${ITEM}#${i + 1}`, state }));
const base = { id: 'pick-1', field: 'items', code: ITEM };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(escalationService.getEscalationWithFormSchema).mockResolvedValue({ escalation: host, form_schema: roster() } as any);
  vi.mocked(assertReadAccess).mockResolvedValue(null as any);
  vi.mocked(scanCodeService.listScanSchemes).mockResolvedValue(SCHEMES as any);
  vi.mocked(loadRoster).mockResolvedValue({ entries: entries(['in', 'waiting']), counts: {} } as any);
  vi.mocked(resolveBatchItem).mockResolvedValue({ status: 200, data: { outcome: 'accepted' } });
});

describe('runRosterScan', () => {
  it('fills the first open entry for the code, with the code as scanned', async () => {
    const result = await runRosterScan(base, station);
    expect(result.status).toBe(200);
    expect(resolveBatchItem).toHaveBeenCalledWith(
      { id: 'pick-1', itemKey: `${ITEM}#2`, resolverPayload: { scannedCode: ITEM } }, station);
  });

  it('refuses a code the list does not expect, or one already checked off', async () => {
    expect(await runRosterScan({ ...base, code: '00036000291452' }, station))
      .toMatchObject({ status: 422, data: { outcome: 'unexpected', error: 'Not one of the items expected here.' } });
    vi.mocked(loadRoster).mockResolvedValue({ entries: entries(['in', 'in']), counts: {} } as any);
    expect(await runRosterScan(base, station))
      .toMatchObject({ status: 422, data: { error: 'All 2 of these are already checked off.' } });
    expect(resolveBatchItem).not.toHaveBeenCalled();
  });

  it('refuses a field that takes no scans, or a scheme it does not take', async () => {
    vi.mocked(escalationService.getEscalationWithFormSchema).mockResolvedValue({ escalation: host, form_schema: roster(null) } as any);
    expect(await runRosterScan(base, station)).toMatchObject({ status: 409, data: { outcome: 'not_accepted' } });
    vi.mocked(escalationService.getEscalationWithFormSchema).mockResolvedValue({ escalation: host, form_schema: roster({ schemes: [17] }) } as any);
    expect(await runRosterScan(base, station)).toMatchObject({ status: 422, data: { outcome: 'not_accepted' } });
    expect(resolveBatchItem).not.toHaveBeenCalled();
  });

  it('answers 404 for a row the station cannot read', async () => {
    vi.mocked(assertReadAccess).mockResolvedValue({ status: 403 } as any);
    expect((await runRosterScan(base, station)).status).toBe(404);
  });

  it('an entry filled since the read moves to the next open one', async () => {
    vi.mocked(loadRoster).mockResolvedValue({ entries: entries(['waiting', 'waiting']), counts: {} } as any);
    vi.mocked(resolveBatchItem)
      .mockResolvedValueOnce({ status: 409, data: { outcome: 'duplicate-item' } })
      .mockResolvedValueOnce({ status: 200, data: { outcome: 'completed' } });
    expect((await runRosterScan(base, station)).status).toBe(200);
    expect(vi.mocked(resolveBatchItem).mock.calls.map((c) => c[0].itemKey)).toEqual([`${ITEM}#1`, `${ITEM}#2`]);
  });

  it('a badge fills as its person, spends one use, and gets it back when the fill does not land', async () => {
    vi.mocked(acting.peekActingAuth).mockResolvedValue({ ok: true, auth: { userId: 'maria' } } as any);
    vi.mocked(acting.consumeActingGrant).mockResolvedValue({ ok: true, grant: { remaining: 2 } } as any);
    const result = await runRosterScan({ ...base, actingToken: 'eph:t' }, station);
    expect(resolveBatchItem).toHaveBeenCalledWith(expect.anything(), { userId: 'maria' });
    expect(result.data).toMatchObject({ acting: { remaining: 2 } });

    vi.mocked(resolveBatchItem).mockResolvedValue({ status: 403, error: 'no' });
    await runRosterScan({ ...base, actingToken: 'eph:t' }, station);
    expect(acting.refundActingGrant).toHaveBeenCalledWith('eph:t', false);
  });
});
