/**
 * Integration tests for the /mcp streamable-http endpoint.
 *
 * Connects to the running app as an external MCP client using the
 * official MCP SDK. Verifies tool discovery, invocation, and auth.
 *
 * Requires docker compose up (the app must be running on port 3000).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { ApiClient, log, waitForHealth } from './helpers';

const BASE_URL = process.env.LT_BASE_URL || 'http://localhost:3000';
const MCP_URL = `${BASE_URL}/mcp`;

let api: ApiClient;
let token: string;

function createMcpClient(bearerToken: string): { client: Client; transport: StreamableHTTPClientTransport } {
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_URL),
    {
      requestInit: {
        headers: { 'Authorization': `Bearer ${bearerToken}` },
      },
    },
  );
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  return { client, transport };
}

beforeAll(async () => {
  await waitForHealth(BASE_URL);
  api = new ApiClient(BASE_URL);
  token = await api.login('superadmin', 'l0ngt@1l');
  log('mcp-test', 'authenticated');
}, 120_000);

describe('MCP Endpoint — /mcp', () => {

  // ── Auth ──────────────────────────────────────────────────────────────

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
        id: 1,
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 405 for GET (stateless mode)', async () => {
    const res = await fetch(MCP_URL, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(405);
  });

  // ── Connection ────────────────────────────────────────────────────────

  it('connects and initializes with valid auth', async () => {
    const { client, transport } = createMcpClient(token);
    await client.connect(transport);
    log('mcp-test', 'connected successfully');
    await client.close();
  });

  // ── Tool Discovery ────────────────────────────────────────────────────

  it('discovers tools via tools/list', async () => {
    const { client, transport } = createMcpClient(token);
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(50);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('get_settings');
    expect(toolNames).toContain('find_tasks');
    expect(toolNames).toContain('store_knowledge');
    expect(toolNames).toContain('list_roles');

    log('mcp-test', `discovered ${tools.length} tools`);
    await client.close();
  });

  // ── Tool Invocation ───────────────────────────────────────────────────

  it('invokes get_settings (read-only, no args)', async () => {
    const { client, transport } = createMcpClient(token);
    await client.connect(transport);

    const result = await client.callTool({ name: 'get_settings', arguments: {} });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    const text = (result.content as any[]).find((c) => c.type === 'text');
    expect(text).toBeDefined();
    const parsed = JSON.parse(text.text);
    expect(parsed).toHaveProperty('events');

    log('mcp-test', 'get_settings invoked');
    await client.close();
  });

  it('invokes list_roles (read-only, returns data)', async () => {
    const { client, transport } = createMcpClient(token);
    await client.connect(transport);

    const result = await client.callTool({ name: 'list_roles', arguments: {} });
    const text = (result.content as any[]).find((c) => c.type === 'text');
    const parsed = JSON.parse(text.text);
    expect(parsed.roles).toBeDefined();
    expect(Array.isArray(parsed.roles)).toBe(true);

    log('mcp-test', `list_roles returned ${parsed.roles.length} roles`);
    await client.close();
  });

  it('invokes knowledge store + retrieve cycle', async () => {
    const { client, transport } = createMcpClient(token);
    await client.connect(transport);

    // Store
    await client.callTool({
      name: 'store_knowledge',
      arguments: {
        domain: 'mcp-integration-test',
        key: 'greeting',
        data: { message: 'hello from MCP client' },
      },
    });

    // Retrieve (new connection — stateless)
    const { client: client2, transport: transport2 } = createMcpClient(token);
    await client2.connect(transport2);

    const result = await client2.callTool({
      name: 'get_knowledge',
      arguments: { domain: 'mcp-integration-test', key: 'greeting' },
    });

    const text = (result.content as any[]).find((c) => c.type === 'text');
    const parsed = JSON.parse(text.text);
    expect(parsed.data?.message).toBe('hello from MCP client');

    log('mcp-test', 'knowledge store/retrieve cycle passed');
    await client.close();
    await client2.close();
  });

  // ── Bot API Key Auth ──────────────────────────────────────────────────

  it('works with service account API key', async () => {
    // Create service account + API key via REST
    const botRes = await fetch(`${BASE_URL}/api/bot-accounts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `mcp-test-bot-${Date.now()}`,
        description: 'Integration test service account',
      }),
    });
    expect(botRes.status).toBe(201);
    const bot = await botRes.json() as any;

    const keyRes = await fetch(`${BASE_URL}/api/bot-accounts/${bot.id}/api-keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'mcp-test-key' }),
    });
    expect(keyRes.status).toBe(201);
    const keyData = await keyRes.json() as any;
    expect(keyData.rawKey).toBeDefined();

    // Connect via MCP with the bot API key
    const { client, transport } = createMcpClient(keyData.rawKey);
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    log('mcp-test', `service account auth: discovered ${tools.length} tools`);
    await client.close();
  });

  it('read-scoped key sees fewer tools than full key', async () => {
    // Create a service account with two keys
    const botName = `mcp-scope-test-${Date.now()}`;
    const botRes = await fetch(`${BASE_URL}/api/bot-accounts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: botName }),
    });
    const bot = await botRes.json() as any;

    // Read key
    const readKeyRes = await fetch(`${BASE_URL}/api/bot-accounts/${bot.id}/api-keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'read', scopes: ['mcp:read'] }),
    });
    const readKeyData = await readKeyRes.json() as any;

    // Full key
    const fullKeyRes = await fetch(`${BASE_URL}/api/bot-accounts/${bot.id}/api-keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'full', scopes: ['mcp:read', 'mcp:full'] }),
    });
    const fullKeyData = await fullKeyRes.json() as any;

    // Discover tools with read key
    const { client: readClient, transport: readTransport } = createMcpClient(readKeyData.rawKey);
    await readClient.connect(readTransport);
    const { tools: readTools } = await readClient.listTools();
    await readClient.close();

    // Discover tools with full key
    const { client: fullClient, transport: fullTransport } = createMcpClient(fullKeyData.rawKey);
    await fullClient.connect(fullTransport);
    const { tools: fullTools } = await fullClient.listTools();
    await fullClient.close();

    // Read key should see fewer tools
    expect(readTools.length).toBeLessThan(fullTools.length);
    expect(readTools.length).toBeGreaterThan(0);

    // Read key should not see write tools
    const readNames = readTools.map((t) => t.name);
    expect(readNames).not.toContain('create_user');
    expect(readNames).not.toContain('invoke_workflow');

    // Read key should see read_safe tools
    expect(readNames).toContain('find_tasks');
    expect(readNames).toContain('get_settings');

    log('mcp-test', `scope test: read=${readTools.length} tools, full=${fullTools.length} tools`);
  });
});
