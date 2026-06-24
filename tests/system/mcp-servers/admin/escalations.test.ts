import { describe, it, expect, vi, beforeEach } from 'vitest';

// All external dependencies are mocked — this pins the MCP wiring, not the DB.
const mockEnsureSystemBot = vi.fn();
const mockListEscalations = vi.fn();
const mockGetEscalation = vi.fn();
const mockGetByWorkflow = vi.fn();
const mockResolveEscalation = vi.fn();
const mockCancelSingle = vi.fn();
const mockBulkCancel = vi.fn();
const mockEscalateToRole = vi.fn();
const mockReleaseEscalation = vi.fn();
const mockResolveBySignalKey = vi.fn();
const mockClaimEscalation = vi.fn();
const mockFindByMetadata = vi.fn();

vi.mock('../../../../services/iam', () => ({
  ensureSystemBot: (...a: unknown[]) => mockEnsureSystemBot(...a),
}));
vi.mock('../../../../api/escalations', () => ({
  listEscalations: (...a: unknown[]) => mockListEscalations(...a),
  getEscalation: (...a: unknown[]) => mockGetEscalation(...a),
  getEscalationsByWorkflowId: (...a: unknown[]) => mockGetByWorkflow(...a),
  resolveEscalation: (...a: unknown[]) => mockResolveEscalation(...a),
  resolveBySignalKey: (...a: unknown[]) => mockResolveBySignalKey(...a),
  cancelSingleEscalation: (...a: unknown[]) => mockCancelSingle(...a),
  bulkCancel: (...a: unknown[]) => mockBulkCancel(...a),
  escalateToRole: (...a: unknown[]) => mockEscalateToRole(...a),
  releaseEscalation: (...a: unknown[]) => mockReleaseEscalation(...a),
  claimEscalation: (...a: unknown[]) => mockClaimEscalation(...a),
}));
vi.mock('../../../../api/escalations/metadata', () => ({
  findByMetadata: (...a: unknown[]) => mockFindByMetadata(...a),
  claimByMetadata: vi.fn(),
  resolveByMetadata: vi.fn(),
}));
vi.mock('../../../../api/escalations/bulk', () => ({
  bulkClaim: vi.fn(), bulkAssign: vi.fn(), bulkEscalate: vi.fn(), updatePriority: vi.fn(),
}));
vi.mock('../../../../services/escalation', () => ({
  getEscalationStats: vi.fn(), releaseExpiredClaims: vi.fn(), bulkResolveForTriage: vi.fn(),
}));

import { registerEscalationTools } from '../../../../system/mcp-servers/admin/escalations';

const SYSTEM_UUID = '11111111-1111-1111-1111-111111111111';

/** Minimal fake McpServer that captures registered tool handlers by name. */
function captureTools() {
  const handlers = new Map<string, (args: any) => Promise<any>>();
  const server = {
    registerTool(name: string, _def: unknown, handler: (args: any) => Promise<any>) {
      handlers.set(name, handler);
    },
  };
  registerEscalationTools(server as any);
  return handlers;
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

let tools: Map<string, (args: any) => Promise<any>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureSystemBot.mockResolvedValue(SYSTEM_UUID);
  tools = captureTools();
});

describe('admin escalation MCP tools — registration', () => {
  it('registers the full RO + RW surface', () => {
    for (const name of [
      'find_escalations', 'get_escalation', 'get_escalations_by_workflow', 'get_escalation_stats',
      'find_by_metadata', 'claim_escalation', 'release_escalation', 'resolve_escalation',
      'resolve_by_signal_key', 'escalate_escalation', 'cancel_escalation', 'bulk_cancel',
    ]) {
      expect(tools.has(name)).toBe(true);
    }
  });
});

describe('lt-system principal fix (theme 3)', () => {
  it('passes the resolved bot UUID — never the "lt-system" string — to find_by_metadata', async () => {
    mockFindByMetadata.mockResolvedValue({ data: { escalations: [], total: 0 } });

    await tools.get('find_by_metadata')!({ key: 'orderId', value: 'A1' });

    const [, auth] = mockFindByMetadata.mock.calls[0];
    expect(auth).toEqual({ userId: SYSTEM_UUID, role: 'superadmin' });
    expect(auth.userId).not.toBe('lt-system');
  });

  it('resolves the system bot once and caches it across tool calls', async () => {
    // Fresh module so the module-level principal cache starts empty (it persists
    // across tests otherwise — which is exactly the caching being verified).
    vi.resetModules();
    const { registerEscalationTools: freshRegister } = await import('../../../../system/mcp-servers/admin/escalations');
    const fresh = new Map<string, (args: any) => Promise<any>>();
    freshRegister({ registerTool: (n: string, _d: unknown, h: any) => fresh.set(n, h) } as any);

    mockEnsureSystemBot.mockResolvedValue(SYSTEM_UUID);
    mockFindByMetadata.mockResolvedValue({ data: {} });
    mockGetEscalation.mockResolvedValue({ data: {} });

    await fresh.get('find_by_metadata')!({ key: 'k', value: 'v' });
    await fresh.get('get_escalation')!({ id: 'e1' });

    expect(mockEnsureSystemBot).toHaveBeenCalledTimes(1);
  });
});

describe('escalation RO/RW parity (theme 4)', () => {
  it('find_escalations forwards new filters and includes metadata in the projection', async () => {
    mockListEscalations.mockResolvedValue({
      data: {
        total: 1,
        escalations: [{ id: 'e1', type: 't', status: 'pending', metadata: { orderId: 'A1' }, trace_id: 'tr' }],
      },
    });

    const res = await tools.get('find_escalations')!({
      subtype: 'sub', assigned_to: 'u1', sort_by: 'created_at', order: 'desc', limit: 10,
    });

    const [input, auth] = mockListEscalations.mock.calls[0];
    expect(input).toMatchObject({ subtype: 'sub', assigned_to: 'u1', sort_by: 'created_at', order: 'desc' });
    expect(auth.userId).toBe(SYSTEM_UUID);

    const parsed = parse(res);
    expect(parsed.escalations[0].metadata).toEqual({ orderId: 'A1' });
    // trace_id stays out of the projection for token efficiency
    expect(parsed.escalations[0].trace_id).toBeUndefined();
  });

  it('resolve_escalation routes through the API with the system principal', async () => {
    mockResolveEscalation.mockResolvedValue({ data: { signaled: true } });

    await tools.get('resolve_escalation')!({ id: 'e1', resolverPayload: { ok: true } });

    expect(mockResolveEscalation).toHaveBeenCalledWith(
      { id: 'e1', resolverPayload: { ok: true } },
      { userId: SYSTEM_UUID, role: 'superadmin' },
    );
  });

  it('cancel_escalation surfaces API errors as isError', async () => {
    mockCancelSingle.mockResolvedValue({ error: 'Escalation not found' });

    const res = await tools.get('cancel_escalation')!({ id: 'missing' });
    expect(res.isError).toBe(true);
    expect(parse(res)).toEqual({ error: 'Escalation not found' });
  });

  it('bulk_cancel forwards ids and the system principal', async () => {
    mockBulkCancel.mockResolvedValue({ data: { cancelled: 2 } });

    await tools.get('bulk_cancel')!({ ids: ['a', 'b'] });
    expect(mockBulkCancel).toHaveBeenCalledWith({ ids: ['a', 'b'] }, { userId: SYSTEM_UUID, role: 'superadmin' });
  });
});
