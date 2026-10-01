import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// /mcp registers only the called tool per request and then calls the SDK's
// private setToolRequestHandlers so unknown and denied tools share one reply.
// An SDK upgrade that renames it must fail here, not as a 500 on every call.
describe('MCP SDK private API used by /mcp', () => {
  it('McpServer still has setToolRequestHandlers', () => {
    const server = new McpServer({ name: 'probe', version: '0.0.0' });
    expect(typeof (server as any).setToolRequestHandlers).toBe('function');
  });
});
