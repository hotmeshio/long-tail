import { describe, it, expect, vi, beforeEach } from 'vitest';

// Invoking or scheduling a compiled workflow needs the identity it runs as to
// be able to call every built-in tool its steps use.
const mocks = vi.hoisted(() => ({
  getYamlWorkflow: vi.fn(),
  invokeService: vi.fn(async () => ({ job_id: 'j1' })),
  granted: new Map<string, Set<string>>(),
  getUserByExternalId: vi.fn(async (id: string) => (id === 'missing-bot' ? null : { id: `${id}-uuid` })),
  updateCronSchedule: vi.fn(async () => null),
}));
vi.mock('../../services/yaml-workflow/db', () => ({
  getYamlWorkflow: mocks.getYamlWorkflow,
  updateCronSchedule: mocks.updateCronSchedule,
}));
vi.mock('../../services/yaml-workflow/deployer', () => ({}));
vi.mock('../../services/yaml-workflow/workers', () => ({}));
vi.mock('../../services/yaml-workflow/invoke', () => ({ invokeYamlWorkflow: mocks.invokeService }));
vi.mock('../../services/cron', () => ({ cronRegistry: { restartYamlCron: vi.fn() } }));
vi.mock('../../services/workflow-invocation', async (io) => ({
  ...(await io<any>()), assertMayActAs: vi.fn(async () => undefined),
}));
vi.mock('../../services/user', () => ({ getUser: vi.fn(), getUserByExternalId: mocks.getUserByExternalId }));
vi.mock('../../api/mcp/tools', () => ({
  builtinServerFor: async (server: string) => (server === 'long-tail-admin' ? server : null),
  builtinToolGate: (_server: string, tool: string) => (tool === 'add_user_role' ? 'superadmin' : 'caller'),
}));
vi.mock('../../modules/capabilities', () => ({
  capabilityAccess: ({ userId }: { userId: string }) => async (gate: string) =>
    gate === 'caller' || (mocks.granted.get(userId)?.has(gate) ?? false),
}));

import { invokeYamlWorkflow } from '../../api/yaml-workflows/deploy';
import { setCronSchedule } from '../../api/yaml-workflows/cron';

const ME = '11111111-1111-4111-8111-111111111111';
const step = (tool: string, server = 'long-tail-admin') =>
  ({ type: 'worker', tool_source: 'mcp', mcp_server_id: server, mcp_tool_name: tool });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.granted.clear();
  mocks.getYamlWorkflow.mockResolvedValue({
    id: 'y1', status: 'active', app_id: 'a', graph_topic: 't',
    activity_manifest: [step('find_escalations'), step('add_user_role'), step('fetch', 'remote-server')],
  });
});

describe('invoking a compiled workflow', () => {
  it('is refused when the caller cannot call a built-in step tool, and nothing runs', async () => {
    const result = await invokeYamlWorkflow({ id: 'y1', data: { role: 'superadmin' } }, { userId: ME });
    expect(result).toEqual({ status: 403, error: 'Forbidden: this workflow calls add_user_role, which is not available to you' });
    expect(mocks.invokeService).not.toHaveBeenCalled();
  });

  it('runs when the caller holds every built-in step gate; external servers are not gated here', async () => {
    mocks.granted.set(ME, new Set(['superadmin']));
    expect((await invokeYamlWorkflow({ id: 'y1', data: {} }, { userId: ME })).status).toBe(200);
    expect(mocks.invokeService).toHaveBeenCalledOnce();
  });

  it('with execute_as, the run identity is the one checked', async () => {
    mocks.granted.set(ME, new Set(['superadmin']));
    const refused = await invokeYamlWorkflow({ id: 'y1', execute_as: 'fleet-bot' }, { userId: ME });
    expect(refused.status).toBe(403);
    mocks.granted.set('fleet-bot-uuid', new Set(['superadmin']));
    expect((await invokeYamlWorkflow({ id: 'y1', execute_as: 'fleet-bot' }, { userId: ME })).status).toBe(200);
  });

  it('an execute_as that names no one is refused', async () => {
    expect((await invokeYamlWorkflow({ id: 'y1', execute_as: 'missing-bot' }, { userId: ME })).status).toBe(404);
  });
});

describe('scheduling a compiled workflow', () => {
  it('is refused when the run identity cannot call a built-in step tool', async () => {
    const result = await setCronSchedule({ id: 'y1', cron_schedule: '0 * * * *' }, { userId: ME });
    expect(result.status).toBe(403);
    expect(mocks.updateCronSchedule).not.toHaveBeenCalled();
  });
});
