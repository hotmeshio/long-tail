import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHumanQueueServer, stopServer } from '../../services/mcp/server';

export interface McpTestContext {
  client: InstanceType<typeof McpClient>;
  cleanup: () => Promise<void>;
}

/**
 * Create an MCP client connected to the Human Queue server
 * via InMemoryTransport. For use in test setup.
 */
export async function createMcpTestClient(): Promise<McpTestContext> {
  // Reset singleton so we get a fresh server instance
  await stopServer();
  const server = await createHumanQueueServer({ name: 'test-human-queue' });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new McpClient(
    { name: 'test-mcp-client', version: '1.0.0' },
  );
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await stopServer();
    },
  };
}

/**
 * Parse an MCP tool result, extracting and JSON-parsing the text content.
 */
export function parseMcpResult(result: any): any {
  if (result.content?.[0]?.text) {
    return JSON.parse(result.content[0].text);
  }
  return result;
}

/**
 * Poll for available escalations via MCP get_available_work until
 * at least one appears for the given role, or timeout.
 */
export async function waitForEscalationViaMcp(
  mcpClient: InstanceType<typeof McpClient>,
  role: string,
  timeoutMs = 45_000,
  intervalMs = 2_000,
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await mcpClient.callTool({
      name: 'get_available_work',
      arguments: { role, limit: 50 },
    });
    const parsed = parseMcpResult(result);
    if (parsed.count > 0) return parsed.escalations;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`No available escalation for role '${role}' within ${timeoutMs}ms`);
}
