import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// With a non-HotMesh engine the catalog matches what each built-in server registered.
const query = vi.fn();
vi.mock('../../lib/db', () => ({ getPool: () => ({ query }) }));
vi.mock('../../modules/capabilities', () => ({ capabilityAccess: () => async () => true }));
vi.mock('../../api/mcp/tools', () => ({
  builtinServerFor: async (name: string) => (name === 'long-tail-admin' ? name : null),
  builtinToolGate: () => 'builder',
}));
const registeredBuiltinToolNames = vi.fn();
vi.mock('../../services/mcp/client', () => ({
  registeredBuiltinToolNames: (name: string) => registeredBuiltinToolNames(name),
}));

import { listCapabilities } from '../../api/capabilities';
import { durableProviderRegistry } from '../../services/durable-provider';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

const tool = (name: string) => ({ name, description: name });
const ROWS = [
  { id: 'a', name: 'long-tail-admin', tags: ['admin'], tool_manifest: [tool('find_escalations'), tool('invoke_workflow')] },
  { id: 'b', name: 'external-crm', tags: ['api'], tool_manifest: [tool('lookup_customer')] },
];

async function listedNames(): Promise<string[]> {
  const result = await listCapabilities({ userId: 'u-1' });
  return (result.data as any).categories.flatMap((c: any) => c.tools.map((t: any) => t.name)).sort();
}

describe('capabilities by engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: ROWS });
    registeredBuiltinToolNames.mockResolvedValue(new Set(['find_escalations']));
  });
  afterEach(() => durableProviderRegistry.clear());

  it('lists only registered built-in tools with a provider', async () => {
    durableProviderRegistry.register(new FakeDurableProvider('dbos'));
    expect(await listedNames()).toEqual(['find_escalations', 'lookup_customer']);
    expect(registeredBuiltinToolNames).toHaveBeenCalledWith('long-tail-admin');
  });

  it('leaves external servers to their stored manifest', async () => {
    durableProviderRegistry.register(new FakeDurableProvider('temporal'));
    expect(await listedNames()).toContain('lookup_customer');
    expect(registeredBuiltinToolNames).not.toHaveBeenCalledWith('external-crm');
  });

  it('lists the stored manifest on HotMesh', async () => {
    expect(await listedNames()).toEqual(['find_escalations', 'invoke_workflow', 'lookup_customer']);
    expect(registeredBuiltinToolNames).not.toHaveBeenCalled();
  });

  it('keeps the stored manifest when the server has no live factory', async () => {
    durableProviderRegistry.register(new FakeDurableProvider('dbos'));
    registeredBuiltinToolNames.mockResolvedValue(null);
    expect(await listedNames()).toEqual(['find_escalations', 'invoke_workflow', 'lookup_customer']);
  });
});
