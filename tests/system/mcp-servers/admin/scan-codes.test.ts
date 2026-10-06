import { describe, it, expect, vi, beforeEach } from 'vitest';

// The scan tools carry every field the routes carry: the held subject and the
// station role on execute, and the not-primed screen on a rule upsert.
const mockExecute = vi.fn();
const mockUpsertRule = vi.fn();
vi.mock('../../../../services/iam', () => ({ ensureSystemBot: vi.fn().mockResolvedValue('system-uuid') }));
vi.mock('../../../../api/scan-codes', () => ({
  executeScanCode: (...a: unknown[]) => mockExecute(...a),
  upsertScanRule: (...a: unknown[]) => mockUpsertRule(...a),
  executeScanChoice: vi.fn(), listScanSchemes: vi.fn(), upsertScanScheme: vi.fn(), deleteScanRule: vi.fn(),
}));

import { registerScanCodeTools } from '../../../../system/mcp-servers/admin/scan-codes';
import { upsertScanRuleSchema, executeScanCodeSchema } from '../../../../system/mcp-servers/admin/schemas';

let tools: Map<string, (args: any) => Promise<any>>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = new Map();
  registerScanCodeTools({ registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any);
  mockExecute.mockResolvedValue({ status: 200, data: { outcome: 'held' } });
  mockUpsertRule.mockResolvedValue({ status: 200, data: {} });
});

describe('scan-code MCP tools', () => {
  it('execute_scan_code forwards the held subject and the station role', async () => {
    const subject = { code: '11:0:K7Q2M9XA', escalationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    await tools.get('execute_scan_code')!({ code: '14:0:SF-A-2', subject, stationRole: 'binning-associate' });
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ code: '14:0:SF-A-2', subject, stationRole: 'binning-associate' }),
      expect.objectContaining({ userId: 'system-uuid' }),
    );
  });

  it('upsert_scan_rule keeps the not-primed screen', async () => {
    await tools.get('upsert_scan_rule')!({
      scheme_version: 14, category: '0', name: 'Bin It', steps: [], fallback: { markdown: 'x' },
      notPrimed: { markdown: 'Scan your badge.' },
    });
    expect(mockUpsertRule.mock.calls[0][0]).toMatchObject({ notPrimed: { markdown: 'Scan your badge.' } });
  });

  it('the rule schema accepts the bench vocabulary', () => {
    const parsed = upsertScanRuleSchema.safeParse({
      scheme_version: 14, category: '0', name: 'Bin It',
      steps: [
        { query: {}, verb: 'hold', params: { hold: { ttlSeconds: 45, expect: { schemes: [14] } } } },
        { query: {}, verb: 'accumulate', subject: { schemes: [11], facets: { binState: 'unbound' } },
          match: { target: ['{subject.freeBins}'] }, refuse: { markdown: 'x', missing: 'y' },
          params: { itemKey: '{subject.orderId}', accumulate: { from: 'subject' } } },
        { query: {}, verb: 'fill', subject: { schemes: [11] }, params: { fill: { into: 'subject' } } },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(executeScanCodeSchema.safeParse({ code: 'x', stationRole: 'r' }).success).toBe(true);
  });
});
