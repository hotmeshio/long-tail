import { describe, it, expect, afterEach } from 'vitest';

// The admin server keeps the invoke and workflow-config tools on any engine
// that starts workflows, and drops HotMesh-only tools elsewhere.
import { createAdminServer } from '../../../../system/mcp-servers/admin';
import { durableProviderRegistry } from '../../../../services/durable-provider';
import { FakeDurableProvider } from '../../../helpers/fake-durable-provider';

async function toolNames(): Promise<Set<string>> {
  const server: any = await createAdminServer({ fresh: true });
  return new Set(Object.keys(server._registeredTools ?? {}));
}

const START_TOOLS = ['invoke_workflow', 'invoke_workflow_read_safe', 'upsert_workflow_config', 'list_workflow_configs'];

describe('admin MCP tools by engine', () => {
  afterEach(() => durableProviderRegistry.clear());

  it('keeps invoke and workflow configs on a provider that starts workflows', async () => {
    durableProviderRegistry.register(new FakeDurableProvider('dbos'));
    const names = await toolNames();
    for (const name of START_TOOLS) expect(names.has(name), name).toBe(true);
    expect(names.has('list_discovered_workflows')).toBe(false);
  });

  it('drops them on a provider that does not start workflows', async () => {
    const provider = new FakeDurableProvider('temporal');
    (provider.capabilities as { start?: boolean }).start = false;
    durableProviderRegistry.register(provider);
    const names = await toolNames();
    for (const name of START_TOOLS) expect(names.has(name), name).toBe(false);
  });

  it('registers everything on HotMesh', async () => {
    const names = await toolNames();
    for (const name of [...START_TOOLS, 'list_discovered_workflows']) expect(names.has(name), name).toBe(true);
  });
});
