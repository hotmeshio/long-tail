import { describe, it, expect, vi, beforeEach } from 'vitest';

// Which principal each escalation tool hands to api/: the /mcp caller when
// the call arrived there, the lt-system bot otherwise.

const mocks = vi.hoisted(() => ({
  ensureSystemBot: vi.fn(async () => '11111111-1111-1111-1111-111111111111'),
  apiCalls: [] as Array<{ fn: string; auth: unknown }>,
  checkBulkPermission: vi.fn(async () => ({ allowed: true as const })),
  service: {
    getEscalationStats: vi.fn(async () => ({ pending: 1 })),
    releaseExpiredClaims: vi.fn(async () => 0),
    bulkResolveForTriage: vi.fn(async () => []),
  },
}));

const recordApi = vi.hoisted(() => async (io: () => Promise<Record<string, unknown>>) => {
  const original = await io();
  return Object.fromEntries(Object.entries(original).map(([name, value]) => [
    name,
    typeof value === 'function'
      ? vi.fn(async (...args: unknown[]) => {
        mocks.apiCalls.push({ fn: name, auth: args[args.length - 1] });
        return { status: 200, data: { pending: 2 } };
      })
      : value,
  ]));
});

vi.mock('../../../../services/iam', () => ({ ensureSystemBot: mocks.ensureSystemBot }));
vi.mock('../../../../api/escalations', (io) => recordApi(io as any));
vi.mock('../../../../api/escalations/metadata', (io) => recordApi(io as any));
vi.mock('../../../../api/escalations/bulk', (io) => recordApi(io as any));
vi.mock('../../../../api/escalations/helpers', async (io) => ({
  ...(await io<typeof import('../../../../api/escalations/helpers')>()),
  checkBulkPermission: mocks.checkBulkPermission,
}));
vi.mock('../../../../services/escalation', () => mocks.service);

import { registerEscalationTools } from '../../../../system/mcp-servers/admin/escalations';

const SYSTEM = { userId: '11111111-1111-1111-1111-111111111111', role: 'superadmin' };
const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'member', scopes: ['mcp:full'] };
const ARGS = { id: 'e1', ids: ['e1'], signalKey: 's', key: 'k', value: 'v', resolverPayload: {}, targetRole: 'r',
  role: 'r', itemKey: 'i', query: {}, groupBy: {}, measure: {}, facet: { key: 'k', value: 'v' }, priority: 2,
  targetUserId: CALLER.userId, workflow_id: 'w' };
const DIRECT_SERVICE_TOOLS = ['get_escalation_stats', 'release_expired_claims', 'bulk_triage'];
// Scoped to an external caller; an internal call passes no principal and reads every row.
const CALLER_SCOPED_TOOLS = ['get_escalations_by_workflow'];

function captureTools(): Map<string, (args: any, extra?: any) => Promise<any>> {
  const handlers = new Map<string, (args: any, extra?: any) => Promise<any>>();
  registerEscalationTools({ registerTool: (name: string, _d: unknown, h: any) => handlers.set(name, h) } as any);
  return handlers;
}

async function authsFor(handler: (args: any, extra?: any) => Promise<any>, extra?: unknown): Promise<unknown[]> {
  mocks.apiCalls.length = 0;
  await handler({ ...ARGS }, extra).catch(() => undefined);
  return mocks.apiCalls.map((c) => c.auth);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkBulkPermission.mockResolvedValue({ allowed: true });
});

describe('escalation tools act as the /mcp caller', () => {
  const tools = captureTools();
  const apiTools = [...tools.keys()].filter((name) => ![...DIRECT_SERVICE_TOOLS, ...CALLER_SCOPED_TOOLS].includes(name));

  it('covers every api-backed escalation tool', () => {
    expect(apiTools.length).toBe(26);
  });

  it('get_escalations_by_workflow is scoped to an external caller, and unscoped internally', async () => {
    const handler = tools.get('get_escalations_by_workflow')!;
    expect(await authsFor(handler, { authInfo: CALLER })).toEqual([CALLER]);
    expect(await authsFor(handler)).toEqual([undefined]);
  });

  for (const name of apiTools) {
    it(`${name} passes the external caller, and lt-system internally`, async () => {
      const external = await authsFor(tools.get(name)!, { authInfo: CALLER });
      expect(external.length, `${name} made no api call`).toBeGreaterThan(0);
      for (const auth of external) expect(auth).toEqual(CALLER);

      const internal = await authsFor(tools.get(name)!);
      for (const auth of internal) expect(auth).toEqual(SYSTEM);
    });
  }
});

describe('escalation tools backed by services', () => {
  const tools = captureTools();

  it('get_escalation_stats is role-scoped for an external caller', async () => {
    const result = await tools.get('get_escalation_stats')!({ period: '1d' }, { authInfo: CALLER });
    expect(mocks.apiCalls.at(-1)).toEqual({ fn: 'getEscalationStats', auth: CALLER });
    expect(JSON.parse(result.content[0].text)).toEqual({ pending: 2 });
    expect(mocks.service.getEscalationStats).not.toHaveBeenCalled();
  });

  it('get_escalation_stats reads every role for internal calls', async () => {
    const result = await tools.get('get_escalation_stats')!({ period: '1d' });
    expect(mocks.service.getEscalationStats).toHaveBeenCalledWith(undefined, '1d');
    expect(JSON.parse(result.content[0].text)).toEqual({ pending: 1 });
  });

  it('bulk_triage refuses ids the external caller may not act on', async () => {
    mocks.checkBulkPermission.mockResolvedValue({ allowed: false, status: 403, error: 'Not authorized' } as any);
    const result = await tools.get('bulk_triage')!({ ids: ['e1'] }, { authInfo: CALLER });
    expect(mocks.checkBulkPermission).toHaveBeenCalledWith(CALLER.userId, ['e1']);
    expect(result.isError).toBe(true);
    expect(mocks.service.bulkResolveForTriage).not.toHaveBeenCalled();
  });

  it('bulk_triage keeps its output for a permitted external caller and skips the check internally', async () => {
    const external = await tools.get('bulk_triage')!({ ids: ['e1'] }, { authInfo: CALLER });
    expect(JSON.parse(external.content[0].text)).toEqual({ triaged: 0, escalation_ids: [] });
    mocks.checkBulkPermission.mockClear();
    await tools.get('bulk_triage')!({ ids: ['e1'] });
    expect(mocks.checkBulkPermission).not.toHaveBeenCalled();
  });
});
