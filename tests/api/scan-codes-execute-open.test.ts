import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/scan-code', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  listScanSchemes: vi.fn(),
  getScanRule: vi.fn(),
}));
vi.mock('../../api/scan-codes/subject', () => ({ resolveSubject: vi.fn() }));
vi.mock('../../api/scan-codes/grant', () => ({ peekGrant: vi.fn(), settleGrant: vi.fn() }));
vi.mock('../../api/scan-codes/identity', () => ({ actingIdentitySatisfied: vi.fn(), executeIdentityScan: vi.fn() }));
vi.mock('../../api/scan-codes/located', () => ({ readsLocated: vi.fn(), loadLocated: vi.fn() }));
vi.mock('../../api/scan-codes/verbs', () => ({
  accumulateStep: vi.fn(), cancelStep: vi.fn(), claimStep: vi.fn(), escalateStep: vi.fn(), releaseStep: vi.fn(), resolveStep: vi.fn(),
}));

import * as scanCodeService from '../../services/scan-code';
import { resolveSubject } from '../../api/scan-codes/subject';
import { settleGrant } from '../../api/scan-codes/grant';
import { loadLocated, readsLocated } from '../../api/scan-codes/located';
import { accumulateStep } from '../../api/scan-codes/verbs';
import { executeScanCode } from '../../api/scan-codes/execute';
import { SCAN_OUTCOMES, type ScanStep } from '../../types';

// The pipeline reads the located row before a step that asks for it, and
// answers with the step's Open button.

const svc = vi.mocked(scanCodeService);
const BAG_SCHEME = {
  version: 11, name: 'Bag', description: null, target_facet: 'orderSlug', encoding: 'delimited', delimiter: ':',
  target_length: null, kind: 'action', grant_ttl_seconds: null, grant_max_uses: 0, grant_scope: 'action', enabled: true,
} as const;
const HELD = { row: { id: 'tub-row', role: 'transfer', metadata: {} }, scheme: { version: 15 }, parsed: {}, code: '15:0:T-1' } as any;
const step: ScanStep = {
  query: {}, verb: 'accumulate', subject: { schemes: [15] },
  refuse: { markdown: 'This bag is at {located.roleTitle}.' },
  open: { target: 'located', label: 'Open the bag' },
  params: { itemKey: '{scan.target}', accumulate: { into: 'subject' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.listScanSchemes.mockResolvedValue([BAG_SCHEME as any]);
  svc.getScanRule.mockResolvedValue({ scheme_version: 11, category: '0', name: 'Load', steps: [step], fallback: {}, notPrimed: {}, enabled: true });
  vi.mocked(resolveSubject).mockResolvedValue({ ok: true, subject: HELD });
  vi.mocked(settleGrant).mockResolvedValue(undefined);
  vi.mocked(readsLocated).mockReturnValue(true);
  vi.mocked(loadLocated).mockImplementation(async (ctx: any) => { ctx.located = { id: 'bag-row', role: 'matching', metadata: {} }; });
  vi.mocked(accumulateStep).mockResolvedValue({ status: 200, data: { outcome: SCAN_OUTCOMES.REFUSED, refusal: { markdown: 'This bag is at Matching.' } } });
});

describe('executeScanCode: located and Open', () => {
  it('reads the located row before the step and answers with its Open button', async () => {
    const result = await executeScanCode({ code: '11:0:K7Q2', subject: { code: '15:0:T-1', escalationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, { userId: 'mover' });
    expect(loadLocated).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadLocated).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(accumulateStep).mock.invocationCallOrder[0]);
    expect(result.data).toMatchObject({ outcome: SCAN_OUTCOMES.REFUSED, open: { label: 'Open the bag', escalationId: 'bag-row' } });
  });

  it('a step that does not ask reads nothing more', async () => {
    vi.mocked(readsLocated).mockReturnValue(false);
    await executeScanCode({ code: '11:0:K7Q2', subject: { code: '15:0:T-1', escalationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, { userId: 'mover' });
    expect(loadLocated).not.toHaveBeenCalled();
  });
});
