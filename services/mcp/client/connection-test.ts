import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { LTMcpToolManifest } from '../../../types';

/**
 * Test connectivity to an MCP server without persisting.
 * Creates a temporary client, connects, lists tools, then disconnects.
 */
export async function testConnection(
  transportType: 'stdio' | 'sse' | 'streamable-http',
  transportConfig: Record<string, any>,
): Promise<{ success: boolean; tools: LTMcpToolManifest[]; error?: string }> {
  const client = new Client({ name: 'long-tail-test', version: '1.0.0' });
  const timeout = setTimeout(() => { throw new Error('Connection timed out (10s)'); }, 10_000);

  try {
    let transport: any;
    if (transportType === 'stdio') {
      transport = new StdioClientTransport({
        command: transportConfig.command!,
        args: transportConfig.args || [],
        env: transportConfig.env,
      });
    } else if (transportType === 'streamable-http') {
      transport = new StreamableHTTPClientTransport(new URL(transportConfig.url!));
    } else {
      transport = new SSEClientTransport(new URL(transportConfig.url!));
    }

    await client.connect(transport);
    const { tools } = await client.listTools();
    const manifest: LTMcpToolManifest[] = tools.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
    }));

    return { success: true, tools: manifest };
  } catch (err: any) {
    return { success: false, tools: [], error: err.message };
  } finally {
    clearTimeout(timeout);
    try { await client.close(); } catch { /* ignore close errors */ }
  }
}
