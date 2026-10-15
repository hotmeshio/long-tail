import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureSystemBot: vi.fn(async () => '11111111-1111-1111-1111-111111111111'),
  executeScanCode: vi.fn(async () => ({ status: 200, data: { outcome: 'executed' } })),
  executeScanChoice: vi.fn(async () => ({ status: 200, data: { outcome: 'executed' } })),
}));

vi.mock('../../../../services/iam', () => ({ ensureSystemBot: mocks.ensureSystemBot }));
vi.mock('../../../../api/scan-codes', async (io) => ({
  ...(await io<typeof import('../../../../api/scan-codes')>()),
  executeScanCode: mocks.executeScanCode,
  executeScanChoice: mocks.executeScanChoice,
}));

import { registerScanCodeTools } from '../../../../system/mcp-servers/admin/scan-codes';

const SYSTEM = { userId: '11111111-1111-1111-1111-111111111111', role: 'superadmin' };
const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'member' };

const tools = new Map<string, (args: any, extra?: any) => Promise<any>>();
registerScanCodeTools({ registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any);

describe('scan-code tools act as the /mcp caller', () => {
  it('execute_scan_code runs as the external caller', async () => {
    await tools.get('execute_scan_code')!({ code: '10:1:abc' }, { authInfo: CALLER });
    expect(mocks.executeScanCode).toHaveBeenLastCalledWith(expect.objectContaining({ code: '10:1:abc' }), CALLER);
  });

  it('execute_scan_code runs as lt-system internally', async () => {
    await tools.get('execute_scan_code')!({ code: '10:1:abc' });
    expect(mocks.executeScanCode).toHaveBeenLastCalledWith(expect.objectContaining({ code: '10:1:abc' }), SYSTEM);
  });

  it('execute_scan_choice runs as the external caller, and lt-system internally', async () => {
    const args = { scheme: 10, category: 1, step: 0, choice: 0, escalationId: 'e1' };
    await tools.get('execute_scan_choice')!(args, { authInfo: CALLER });
    expect(mocks.executeScanChoice).toHaveBeenLastCalledWith(args, CALLER);
    await tools.get('execute_scan_choice')!(args);
    expect(mocks.executeScanChoice).toHaveBeenLastCalledWith(args, SYSTEM);
  });
});
