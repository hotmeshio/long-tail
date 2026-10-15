import { describe, it, expect, vi, beforeEach } from 'vitest';

// get_workflow_status and export_workflow_execution follow the REST rule for
// a run: a builder, or the person who started it or it runs as.

const mocks = vi.hoisted(() => ({
  mayRead: vi.fn(),
  getWorkflowResult: vi.fn(),
  exportWorkflowExecution: vi.fn(),
}));
vi.mock('../../../../modules/capabilities', async (io) => ({
  ...(await io<typeof import('../../../../modules/capabilities')>()),
  mayReadWorkflowRun: mocks.mayRead,
}));
vi.mock('../../../../api/workflows', async (io) => ({
  ...(await io<typeof import('../../../../api/workflows')>()),
  getWorkflowResult: mocks.getWorkflowResult,
}));
vi.mock('../../../../api/exports', async (io) => ({
  ...(await io<typeof import('../../../../api/exports')>()),
  exportWorkflowExecution: mocks.exportWorkflowExecution,
}));

import { registerWorkflowTools } from '../../../../system/mcp-servers/admin/workflows';
import { registerExportTools } from '../../../../system/mcp-servers/admin/exports';
import { RUN_READ_DENIED } from '../../../../system/mcp-servers/admin/run-read';

type Handler = (args: any, extra?: any) => Promise<any>;
const tools = new Map<string, Handler>();
const capture = { registerTool: (name: string, _d: unknown, h: Handler) => { tools.set(name, h); } } as any;
registerWorkflowTools(capture);
registerExportTools(capture);

const CALLER = { userId: '11111111-1111-4111-8111-111111111111', role: 'member' };
const extra = { authInfo: CALLER };
const parse = (r: any) => JSON.parse(r.content[0].text);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWorkflowResult.mockResolvedValue({ status: 200, data: { state: 'complete', result: { ok: true } } });
  mocks.exportWorkflowExecution.mockResolvedValue({ status: 200, data: { events: [] } });
});

describe.each([
  ['get_workflow_status', mocks.getWorkflowResult],
  ['export_workflow_execution', mocks.exportWorkflowExecution],
])('%s', (name, read) => {
  it('serves the run to a caller who may read it, checked as that caller', async () => {
    mocks.mayRead.mockResolvedValue(true);
    const result = await tools.get(name)!({ workflow_id: 'wf-1' }, extra);
    expect(result.isError).toBeUndefined();
    expect(mocks.mayRead).toHaveBeenCalledWith(CALLER, 'wf-1');
    expect(read).toHaveBeenCalled();
  });

  it('refuses anyone else and reads nothing', async () => {
    mocks.mayRead.mockResolvedValue(false);
    const result = await tools.get(name)!({ workflow_id: 'wf-1' }, extra);
    expect(result.isError).toBe(true);
    expect(parse(result).error).toBe(RUN_READ_DENIED);
    expect(read).not.toHaveBeenCalled();
  });
});
