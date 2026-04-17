import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { start } from '../../../start';
import { mcpRegistry } from '../../../services/mcp/index';
import * as mcpDbService from '../../../services/mcp/db';
import { createHumanQueueServer, stopServer } from '../../../services/mcp/server';
import * as escalationService from '../../../services/escalation';
import { loggerRegistry } from '../../../lib/logger';
import { telemetryRegistry } from '../../../lib/telemetry';
import { eventRegistry } from '../../../lib/events';
import { maintenanceRegistry } from '../../../services/maintenance';
import type { LTMcpAdapter, LTMcpToolManifest } from '../../../types/mcp';
import type { LTInstance } from '../../../types/startup';

// ── Stub MCP Adapter ──────────────────────────────────────────────────────

class StubMcpAdapter implements LTMcpAdapter {
  connected = false;
  disconnected = false;
  clients: string[] = [];
  tools: Map<string, LTMcpToolManifest[]> = new Map();
  toolCalls: { serverId: string; toolName: string; args: any }[] = [];

  async connect() { this.connected = true; }
  async disconnect() { this.disconnected = true; this.connected = false; }
  async connectClient(serverId: string) { this.clients.push(serverId); }
  async disconnectClient(serverId: string) {
    this.clients = this.clients.filter(c => c !== serverId);
  }
  async listTools(serverId: string) {
    return this.tools.get(serverId) || [];
  }
  async callTool(serverId: string, toolName: string, args: any) {
    this.toolCalls.push({ serverId, toolName, args });
    return { result: 'stub' };
  }
  async toolActivities(serverId: string) {
    const tools = await this.listTools(serverId);
    const activities: Record<string, any> = {};
    for (const t of tools) {
      activities[`mcp_stub_${t.name}`] = async (args: any) =>
        this.callTool(serverId, t.name, args);
    }
    return activities;
  }
}

// ── Test config ───────────────────────────────────────────────────────────

const TEST_DB = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: 'longtail_test',
};

function clearRegistries() {
  loggerRegistry.clear();
  telemetryRegistry.clear();
  eventRegistry.clear();
  maintenanceRegistry.clear();
  mcpRegistry.clear();
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('MCP integration', () => {

  // ── Registry pattern ────────────────────────────────────────────────

  describe('mcpRegistry', () => {
    afterEach(() => { mcpRegistry.clear(); });

    it('should report no adapter before registration', () => {
      expect(mcpRegistry.hasAdapter).toBe(false);
      expect(mcpRegistry.current).toBeNull();
    });

    it('should register and expose the adapter', () => {
      const stub = new StubMcpAdapter();
      mcpRegistry.register(stub);
      expect(mcpRegistry.hasAdapter).toBe(true);
      expect(mcpRegistry.current).toBe(stub);
    });

    it('should connect and disconnect the adapter', async () => {
      const stub = new StubMcpAdapter();
      mcpRegistry.register(stub);
      await mcpRegistry.connect();
      expect(stub.connected).toBe(true);
      await mcpRegistry.disconnect();
      expect(stub.disconnected).toBe(true);
    });

    it('should be idempotent on double connect', async () => {
      const stub = new StubMcpAdapter();
      mcpRegistry.register(stub);
      await mcpRegistry.connect();
      await mcpRegistry.connect(); // no-op
      expect(stub.connected).toBe(true);
    });

    it('should clear state', () => {
      mcpRegistry.register(new StubMcpAdapter());
      mcpRegistry.clear();
      expect(mcpRegistry.hasAdapter).toBe(false);
    });
  });

  // ── start() integration ─────────────────────────────────────────────

  describe('start() with MCP config', () => {
    let lt: LTInstance;
    const stubMcp = new StubMcpAdapter();

    beforeAll(async () => {
      clearRegistries();
      lt = await start({
        database: TEST_DB,
        server: { enabled: false },
        maintenance: false,
        mcp: { adapter: stubMcp },
      });
    }, 30_000);

    afterAll(async () => {
      await lt.shutdown();
      clearRegistries();
    }, 15_000);

    it('should register the MCP adapter', () => {
      expect(mcpRegistry.hasAdapter).toBe(true);
    });

    it('should return a client and shutdown function', () => {
      expect(lt.client).toBeTruthy();
      expect(typeof lt.shutdown).toBe('function');
    });
  });

  // ── Database service (CRUD) ─────────────────────────────────────────

  describe('MCP server CRUD', () => {
    let lt: LTInstance;

    beforeAll(async () => {
      clearRegistries();
      lt = await start({
        database: TEST_DB,
        server: { enabled: false },
        maintenance: false,
      });
    }, 30_000);

    afterAll(async () => {
      await lt.shutdown();
      clearRegistries();
    }, 15_000);

    it('should create an MCP server registration', async () => {
      const server = await mcpDbService.createMcpServer({
        name: `test-mcp-create-${Date.now()}`,
        description: 'Test server',
        transport_type: 'stdio',
        transport_config: { command: 'node', args: ['server.js'] },
        auto_connect: false,
      });
      expect(server.id).toBeTruthy();
      expect(server.transport_type).toBe('stdio');
      expect(server.status).toBe('registered');
    });

    it('should read an MCP server by ID', async () => {
      const created = await mcpDbService.createMcpServer({
        name: `test-mcp-read-${Date.now()}`,
        transport_type: 'sse',
        transport_config: { url: 'http://localhost:8080/sse' },
      });
      const fetched = await mcpDbService.getMcpServer(created.id);
      expect(fetched).toBeTruthy();
      expect(fetched!.transport_type).toBe('sse');
    });

    it('should read an MCP server by name', async () => {
      const name = `test-mcp-byname-${Date.now()}`;
      await mcpDbService.createMcpServer({
        name,
        transport_type: 'stdio',
        transport_config: { command: 'echo' },
      });
      const fetched = await mcpDbService.getMcpServerByName(name);
      expect(fetched).toBeTruthy();
      expect(fetched!.name).toBe(name);
    });

    it('should update an MCP server', async () => {
      const created = await mcpDbService.createMcpServer({
        name: `test-mcp-update-${Date.now()}`,
        transport_type: 'stdio',
        transport_config: { command: 'python' },
      });
      const updated = await mcpDbService.updateMcpServer(created.id, {
        description: 'Updated description',
        auto_connect: true,
      });
      expect(updated!.description).toBe('Updated description');
      expect(updated!.auto_connect).toBe(true);
    });

    it('should delete an MCP server', async () => {
      const created = await mcpDbService.createMcpServer({
        name: `test-mcp-delete-${Date.now()}`,
        transport_type: 'stdio',
        transport_config: { command: 'echo' },
      });
      const deleted = await mcpDbService.deleteMcpServer(created.id);
      expect(deleted).toBe(true);
      const fetched = await mcpDbService.getMcpServer(created.id);
      expect(fetched).toBeNull();
    });

    it('should list MCP servers with filters', async () => {
      const name = `test-mcp-list-${Date.now()}`;
      await mcpDbService.createMcpServer({
        name,
        transport_type: 'stdio',
        transport_config: { command: 'node' },
      });
      const { servers, total } = await mcpDbService.listMcpServers({
        status: 'registered',
      });
      expect(total).toBeGreaterThan(0);
      expect(servers.every(s => s.status === 'registered')).toBe(true);
    });

    it('should update server status with tool manifest', async () => {
      const created = await mcpDbService.createMcpServer({
        name: `test-mcp-status-${Date.now()}`,
        transport_type: 'stdio',
        transport_config: { command: 'node' },
      });
      const manifest = [
        { name: 'search', description: 'Search tool', inputSchema: {} },
        { name: 'analyze', description: 'Analysis tool', inputSchema: {} },
      ];
      await mcpDbService.updateMcpServerStatus(created.id, 'connected', manifest);
      const fetched = await mcpDbService.getMcpServer(created.id);
      expect(fetched!.status).toBe('connected');
      expect(fetched!.tool_manifest).toHaveLength(2);
      expect(fetched!.last_connected_at).toBeTruthy();
    });

    it('should reject duplicate names', async () => {
      const name = `test-mcp-dup-${Date.now()}`;
      await mcpDbService.createMcpServer({
        name,
        transport_type: 'stdio',
        transport_config: { command: 'node' },
      });
      await expect(
        mcpDbService.createMcpServer({
          name,
          transport_type: 'stdio',
          transport_config: { command: 'node' },
        }),
      ).rejects.toThrow();
    });

    it('should return auto-connect servers', async () => {
      const name = `test-mcp-auto-${Date.now()}`;
      await mcpDbService.createMcpServer({
        name,
        transport_type: 'stdio',
        transport_config: { command: 'node' },
        auto_connect: true,
      });
      const autoServers = await mcpDbService.getAutoConnectServers();
      expect(autoServers.some(s => s.name === name)).toBe(true);
    });
  });

  // ── REST API via start() ────────────────────────────────────────────

  describe('MCP REST API', () => {
    let lt: LTInstance;
    const port = 4599;

    beforeAll(async () => {
      clearRegistries();
      lt = await start({
        database: TEST_DB,
        server: { port },
        auth: { secret: 'test-mcp-secret' },
        maintenance: false,
        mcp: { adapter: new StubMcpAdapter() },
      });
    }, 30_000);

    afterAll(async () => {
      await lt.shutdown();
      clearRegistries();
    }, 15_000);

    it('should require auth on GET /api/mcp/servers', async () => {
      const res = await fetch(`http://localhost:${port}/api/mcp/servers`);
      expect(res.status).toBe(401);
    });

    it('should require auth on POST /api/mcp/servers', async () => {
      const res = await fetch(`http://localhost:${port}/api/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'rest-test',
          transport_type: 'stdio',
          transport_config: { command: 'echo' },
        }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── Shutdown lifecycle ──────────────────────────────────────────────

  describe('shutdown disconnects MCP', () => {
    it('should disconnect MCP adapter on shutdown', async () => {
      clearRegistries();
      const stubMcp = new StubMcpAdapter();
      const lt = await start({
        database: TEST_DB,
        server: { enabled: false },
        maintenance: false,
        mcp: { adapter: stubMcp },
      });

      await lt.shutdown();
      expect(stubMcp.disconnected).toBe(true);
      clearRegistries();
    }, 30_000);
  });

  // ── Stub adapter behavior ──────────────────────────────────────────

  describe('StubMcpAdapter', () => {
    it('should track tool calls', async () => {
      const stub = new StubMcpAdapter();
      stub.tools.set('server-1', [
        { name: 'search', description: 'Search', inputSchema: {} },
      ]);

      const activities = await stub.toolActivities('server-1');
      expect(Object.keys(activities)).toEqual(['mcp_stub_search']);

      await activities['mcp_stub_search']({ query: 'hello' });
      expect(stub.toolCalls).toHaveLength(1);
      expect(stub.toolCalls[0]).toEqual({
        serverId: 'server-1',
        toolName: 'search',
        args: { query: 'hello' },
      });
    });

    it('should track client connections', async () => {
      const stub = new StubMcpAdapter();
      await stub.connectClient('server-a');
      await stub.connectClient('server-b');
      expect(stub.clients).toEqual(['server-a', 'server-b']);

      await stub.disconnectClient('server-a');
      expect(stub.clients).toEqual(['server-b']);
    });
  });

  // ── MCP protocol (InMemoryTransport) ─────────────────────────────

  describe('MCP protocol (InMemoryTransport)', () => {
    let lt: LTInstance;
    let mcpClient: InstanceType<typeof McpClient>;

    beforeAll(async () => {
      clearRegistries();
      // Start app for DB pool only (no HTTP server, no MCP adapter)
      lt = await start({
        database: TEST_DB,
        server: { enabled: false },
        maintenance: false,
      });

      // Reset singleton, then create fresh Human Queue MCP server
      await stopServer();
      const mcpServer = await createHumanQueueServer({ name: 'test-human-queue' });

      // Wire up InMemoryTransport
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);

      mcpClient = new McpClient(
        { name: 'test-mcp-client', version: '1.0.0' },
      );
      await mcpClient.connect(clientTransport);
    }, 30_000);

    afterAll(async () => {
      await mcpClient.close();
      await stopServer();
      await lt.shutdown();
      clearRegistries();
    }, 15_000);

    it('should discover all 4 registered tools via listTools()', async () => {
      const { tools } = await mcpClient.listTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('escalate_to_human');
      expect(names).toContain('check_resolution');
      expect(names).toContain('get_available_work');
      expect(names).toContain('claim_and_resolve');
      expect(names).toContain('escalate_and_wait');
      expect(tools).toHaveLength(5);
    });

    it('should create a real escalation via escalate_to_human', async () => {
      const result = await mcpClient.callTool({
        name: 'escalate_to_human',
        arguments: {
          role: 'reviewer',
          message: 'MCP protocol test escalation',
          data: { testKey: 'testValue' },
          type: 'mcp',
          subtype: 'tool_call',
          priority: 2,
        },
      });

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse((result.content as any[])[0].text);
      expect(parsed.escalation_id).toBeTruthy();
      expect(parsed.status).toBe('pending');
      expect(parsed.role).toBe('reviewer');

      // Verify in database
      const dbRecord = await escalationService.getEscalation(parsed.escalation_id);
      expect(dbRecord).toBeTruthy();
      expect(dbRecord!.description).toBe('MCP protocol test escalation');
    });

    it('should check escalation status via check_resolution', async () => {
      // Create an escalation first
      const createResult = await mcpClient.callTool({
        name: 'escalate_to_human',
        arguments: { role: 'reviewer', message: 'check test' },
      });
      const { escalation_id } = JSON.parse((createResult.content as any[])[0].text);

      const checkResult = await mcpClient.callTool({
        name: 'check_resolution',
        arguments: { escalation_id },
      });
      const parsed = JSON.parse((checkResult.content as any[])[0].text);
      expect(parsed.escalation_id).toBe(escalation_id);
      expect(parsed.status).toBe('pending');
    });

    it('should find available work via get_available_work', async () => {
      const uniqueRole = `test-role-${Date.now()}`;

      // Create an escalation with a unique role
      await mcpClient.callTool({
        name: 'escalate_to_human',
        arguments: { role: uniqueRole, message: 'available work test' },
      });

      const result = await mcpClient.callTool({
        name: 'get_available_work',
        arguments: { role: uniqueRole, limit: 10 },
      });
      const parsed = JSON.parse((result.content as any[])[0].text);
      expect(parsed.count).toBeGreaterThanOrEqual(1);
      expect(parsed.escalations[0].role).toBe(uniqueRole);
    });

    it('should claim and resolve via claim_and_resolve', async () => {
      // Create
      const createResult = await mcpClient.callTool({
        name: 'escalate_to_human',
        arguments: { role: 'reviewer', message: 'claim test' },
      });
      const { escalation_id } = JSON.parse((createResult.content as any[])[0].text);

      // Claim and resolve
      const resolveResult = await mcpClient.callTool({
        name: 'claim_and_resolve',
        arguments: {
          escalation_id,
          resolver_id: 'test-agent',
          payload: { approved: true, note: 'Looks good' },
        },
      });
      const parsed = JSON.parse((resolveResult.content as any[])[0].text);
      expect(parsed.status).toBe('resolved');
      expect(parsed.resolved_at).toBeTruthy();

      // Verify in DB
      const dbRecord = await escalationService.getEscalation(escalation_id);
      expect(dbRecord!.status).toBe('resolved');
    });

    it('should complete a full escalation lifecycle via MCP protocol', async () => {
      const uniqueRole = `lifecycle-${Date.now()}`;

      // 1. Escalate
      const create = await mcpClient.callTool({
        name: 'escalate_to_human',
        arguments: {
          role: uniqueRole,
          message: 'Full lifecycle test',
          data: { step: 'initial' },
        },
      });
      const { escalation_id } = JSON.parse((create.content as any[])[0].text);

      // 2. Check — should be pending
      const check1 = await mcpClient.callTool({
        name: 'check_resolution',
        arguments: { escalation_id },
      });
      expect(JSON.parse((check1.content as any[])[0].text).status).toBe('pending');

      // 3. Get available work — should include our escalation
      const available = await mcpClient.callTool({
        name: 'get_available_work',
        arguments: { role: uniqueRole },
      });
      const items = JSON.parse((available.content as any[])[0].text);
      expect(items.escalations.some((e: any) => e.escalation_id === escalation_id)).toBe(true);

      // 4. Claim and resolve
      await mcpClient.callTool({
        name: 'claim_and_resolve',
        arguments: {
          escalation_id,
          resolver_id: 'lifecycle-agent',
          payload: { resolution: 'approved' },
        },
      });

      // 5. Check — should be resolved with payload
      const check2 = await mcpClient.callTool({
        name: 'check_resolution',
        arguments: { escalation_id },
      });
      const final = JSON.parse((check2.content as any[])[0].text);
      expect(final.status).toBe('resolved');
      expect(final.resolver_payload.resolution).toBe('approved');

      // 6. Get available work — should NOT include resolved escalation
      const available2 = await mcpClient.callTool({
        name: 'get_available_work',
        arguments: { role: uniqueRole },
      });
      const items2 = JSON.parse((available2.content as any[])[0].text);
      expect(items2.escalations.some((e: any) => e.escalation_id === escalation_id)).toBe(false);
    });

    it('should return isError for nonexistent escalation', async () => {
      const result = await mcpClient.callTool({
        name: 'check_resolution',
        arguments: { escalation_id: '00000000-0000-0000-0000-000000000000' },
      });
      const parsed = JSON.parse((result.content as any[])[0].text);
      expect(parsed.error).toBe('Escalation not found');
      expect(result.isError).toBe(true);
    });

    it('should return isError when claiming an already-resolved escalation', async () => {
      // Create and immediately resolve
      const create = await mcpClient.callTool({
        name: 'escalate_to_human',
        arguments: { role: 'reviewer', message: 'double-resolve test' },
      });
      const { escalation_id } = JSON.parse((create.content as any[])[0].text);

      await mcpClient.callTool({
        name: 'claim_and_resolve',
        arguments: { escalation_id, resolver_id: 'agent-1', payload: { ok: true } },
      });

      // Try to claim again — should fail
      const result = await mcpClient.callTool({
        name: 'claim_and_resolve',
        arguments: { escalation_id, resolver_id: 'agent-2', payload: { ok: true } },
      });
      const parsed = JSON.parse((result.content as any[])[0].text);
      expect(parsed.error).toBeTruthy();
      expect(result.isError).toBe(true);
    });
  });
});
