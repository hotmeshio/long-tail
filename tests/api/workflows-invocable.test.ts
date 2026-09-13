import { describe, it, expect, vi, beforeEach } from 'vitest';

// The per-caller list runs the invoke gate's own predicate over every config.
const mockListConfigs = vi.fn();
const mockGetUser = vi.fn();
const mockWorkers = vi.fn();

vi.mock('../../services/config', () => ({
  listWorkflowConfigs: (...a: unknown[]) => mockListConfigs(...a),
}));
vi.mock('../../services/user', () => ({
  getUser: (...a: unknown[]) => mockGetUser(...a),
}));
vi.mock('../../services/workers/registry', () => ({
  getRegisteredWorkers: () => mockWorkers(),
  SYSTEM_WORKFLOWS: new Set(['ltSystemFlow']),
}));

import { listInvocableWorkflows } from '../../api/workflows/invocable';

const cfg = (workflow_type: string, invocation_roles: string[], extra: Record<string, unknown> = {}) => ({
  workflow_type, invocable: true, certified: false, task_queue: 'q', default_role: 'reviewer',
  description: null, roles: [], invocation_roles, consumes: [], tool_tags: [],
  envelope_schema: null, input_schema: null, resolver_schema: null, cron_schedule: null,
  execute_as: null, read_safe: false, ...extra,
});

const names = (result: any) => result.data.workflows.map((w: any) => w.workflow_type);

beforeEach(() => {
  vi.clearAllMocks();
  mockListConfigs.mockResolvedValue([
    cfg('fleetTools', ['printer-fleet']),
    cfg('basicEcho', ['engineer', 'superadmin']),
    cfg('openToAll', []),
    cfg('disabled', [], { invocable: false }),
    cfg('certifiedOne', ['engineer'], { certified: true }),
  ]);
  mockWorkers.mockReturnValue(new Map([
    ['fleetTools', { taskQueue: 'q' }],
    ['unregisteredFlow', { taskQueue: 'adhoc' }],
    ['ltSystemFlow', { taskQueue: 'system' }],
  ]));
});

describe('listInvocableWorkflows', () => {
  it('a member sees role-matching and open workflows, never durable fallbacks', async () => {
    mockGetUser.mockResolvedValue({ roles: [{ role: 'printer-fleet', type: 'member' }] });
    const result = await listInvocableWorkflows({ userId: 'u1', role: 'member' });
    expect(result.status).toBe(200);
    expect(names(result)).toEqual(['fleetTools', 'openToAll']);
    expect(result.data.workflows[0].tier).toBe('registered');
  });

  it('admin/admin sees every invocable config plus active unregistered workers', async () => {
    mockGetUser.mockResolvedValue({ roles: [{ role: 'admin', type: 'admin' }] });
    const result = await listInvocableWorkflows({ userId: 'u2', role: 'admin' });
    expect(names(result)).toEqual(['basicEcho', 'certifiedOne', 'fleetTools', 'openToAll', 'unregisteredFlow']);
    const durable = result.data.workflows.find((w: any) => w.workflow_type === 'unregisteredFlow');
    expect(durable).toMatchObject({ tier: 'durable', task_queue: 'adhoc', invocable: true, input_schema: null });
    const certified = result.data.workflows.find((w: any) => w.workflow_type === 'certifiedOne');
    expect(certified.tier).toBe('certified');
  });

  it('a superadmin JWT with no user row still gets the full list', async () => {
    mockGetUser.mockResolvedValue(null);
    const result = await listInvocableWorkflows({ userId: 'ghost', role: 'superadmin' });
    expect(names(result)).toContain('basicEcho');
    expect(names(result)).toContain('unregisteredFlow');
    expect(names(result)).not.toContain('ltSystemFlow');
  });

  it('a caller with no grants sees only open workflows', async () => {
    mockGetUser.mockResolvedValue({ roles: [] });
    const result = await listInvocableWorkflows({ userId: 'u3' });
    expect(names(result)).toEqual(['openToAll']);
  });

  it('a failing read is a 500, never an empty success', async () => {
    mockListConfigs.mockRejectedValue(new Error('db down'));
    mockGetUser.mockResolvedValue({ roles: [] });
    const result = await listInvocableWorkflows({ userId: 'u3' });
    expect(result.status).toBe(500);
  });
});
