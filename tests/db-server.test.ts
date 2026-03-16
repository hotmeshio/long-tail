import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { start } from '../start';
import { createDbServer, stopDbServer } from '../services/mcp/db-server';
import * as taskService from '../services/task';
import * as escalationService from '../services/escalation';
import * as configService from '../services/config';
import { loggerRegistry } from '../services/logger';
import { telemetryRegistry } from '../services/telemetry';
import { eventRegistry } from '../services/events';
import { maintenanceRegistry } from '../services/maintenance';
import { mcpRegistry } from '../services/mcp/index';
import { parseMcpResult } from './setup/mcp';
import type { LTInstance } from '../types/startup';

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

describe('DB MCP server', () => {
  let lt: LTInstance;
  let mcpClient: InstanceType<typeof McpClient>;
  const taskIds: string[] = [];
  const escalationIds: string[] = [];

  beforeAll(async () => {
    clearRegistries();

    lt = await start({
      database: TEST_DB,
      server: { enabled: false },
      maintenance: false,
    });

    // Reset singleton and create fresh DB MCP server
    await stopDbServer();
    const server = await createDbServer({ name: 'test-db-query' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    mcpClient = new McpClient({ name: 'test-db-client', version: '1.0.0' });
    await mcpClient.connect(clientTransport);

    // Seed a workflow config so get_workflow_types has data
    await configService.upsertWorkflowConfig({
      workflow_type: 'dbServerTest',
      invocable: true,
      task_queue: 'lt-db-test',
      default_role: 'reviewer',
      default_modality: 'system',
      description: 'Test workflow for db-server tests',
      roles: [],
      invocation_roles: [],
      consumes: [],
    });

    // Seed tasks with trace_id/span_id
    const task1 = await taskService.createTask({
      workflow_id: `db-test-wf-${Date.now()}-1`,
      workflow_type: 'dbServerTest',
      lt_type: 'dbServerTest',
      status: 'completed',
      priority: 2,
      signal_id: 'sig-db-1',
      parent_workflow_id: 'parent-db-1',
      envelope: JSON.stringify({ data: { test: true } }),
      trace_id: 'trace-db-test-001',
      span_id: 'span-db-test-001',
    });
    taskIds.push(task1.id);

    const task2 = await taskService.createTask({
      workflow_id: `db-test-wf-${Date.now()}-2`,
      workflow_type: 'dbServerTest',
      lt_type: 'dbServerTest',
      status: 'pending',
      priority: 3,
      signal_id: 'sig-db-2',
      parent_workflow_id: 'parent-db-2',
      envelope: JSON.stringify({ data: { test: true } }),
      trace_id: 'trace-db-test-002',
      span_id: 'span-db-test-002',
    });
    taskIds.push(task2.id);

    // Seed escalation with trace_id/span_id
    const esc = await escalationService.createEscalation({
      type: 'test',
      subtype: 'db-server-test',
      modality: 'system',
      role: 'reviewer',
      envelope: JSON.stringify({ data: { test: true } }),
      trace_id: 'trace-esc-test-001',
      span_id: 'span-esc-test-001',
    });
    escalationIds.push(esc.id);
  }, 30_000);

  afterAll(async () => {
    // Cleanup test data
    const { getPool } = await import('../services/db');
    const pool = getPool();
    if (taskIds.length) {
      await pool.query(
        'DELETE FROM lt_tasks WHERE id = ANY($1::uuid[])',
        [taskIds],
      );
    }
    if (escalationIds.length) {
      await pool.query(
        'DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])',
        [escalationIds],
      );
    }
    await pool.query(
      "DELETE FROM lt_config_workflows WHERE workflow_type = 'dbServerTest'",
    );

    await mcpClient.close();
    await stopDbServer();
    await lt.shutdown();
    clearRegistries();
  }, 15_000);

  // ── Tool discovery ──────────────────────────────────────────────────

  it('should discover all 6 registered tools', async () => {
    const { tools } = await mcpClient.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('find_tasks');
    expect(names).toContain('find_escalations');
    expect(names).toContain('get_process_summary');
    expect(names).toContain('get_escalation_stats');
    expect(names).toContain('get_workflow_types');
    expect(names).toContain('get_system_health');
    expect(tools).toHaveLength(6);
  });

  // ── find_tasks with trace_id ────────────────────────────────────────

  it('should return trace_id and span_id in find_tasks results', async () => {
    const result = await mcpClient.callTool({
      name: 'find_tasks',
      arguments: { workflow_type: 'dbServerTest', limit: 10 },
    });

    const parsed = parseMcpResult(result);
    expect(parsed.total).toBeGreaterThanOrEqual(2);

    const task = parsed.tasks.find((t: any) => t.trace_id === 'trace-db-test-001');
    expect(task).toBeTruthy();
    expect(task.trace_id).toBe('trace-db-test-001');
    expect(task.span_id).toBe('span-db-test-001');
  });

  it('should filter tasks by status', async () => {
    const result = await mcpClient.callTool({
      name: 'find_tasks',
      arguments: { status: 'pending' },
    });

    const parsed = parseMcpResult(result);
    expect(parsed.total).toBeGreaterThanOrEqual(1);
    expect(parsed.tasks.every((t: any) => t.status === 'pending')).toBe(true);

    // Our seeded pending task should appear
    const seeded = parsed.tasks.find((t: any) => t.id === taskIds[1]);
    expect(seeded).toBeTruthy();
    expect(seeded.trace_id).toBe('trace-db-test-002');
  });

  // ── find_escalations with trace_id ──────────────────────────────────

  it('should return core fields in find_escalations results (trace_id/span_id omitted for LLM efficiency)', async () => {
    const result = await mcpClient.callTool({
      name: 'find_escalations',
      arguments: { type: 'test', limit: 10 },
    });

    const parsed = parseMcpResult(result);
    expect(parsed.total).toBeGreaterThanOrEqual(1);

    const esc = parsed.escalations.find(
      (e: any) => e.type === 'test',
    );
    expect(esc).toBeTruthy();
    expect(esc.type).toBe('test');
    expect(esc.status).toBeDefined();
    expect(esc.trace_id).toBeUndefined();
    expect(esc.span_id).toBeUndefined();
  });

  // ── get_workflow_types ──────────────────────────────────────────────

  it('should return workflow configurations', async () => {
    const result = await mcpClient.callTool({
      name: 'get_workflow_types',
      arguments: {},
    });

    const parsed = parseMcpResult(result);
    expect(parsed.count).toBeGreaterThanOrEqual(1);

    const wf = parsed.workflows.find(
      (w: any) => w.workflow_type === 'dbServerTest',
    );
    expect(wf).toBeTruthy();

    expect(wf.task_queue).toBe('lt-db-test');
  });

  // ── get_system_health ───────────────────────────────────────────────

  it('should return system health snapshot', async () => {
    const result = await mcpClient.callTool({
      name: 'get_system_health',
      arguments: {},
    });

    const parsed = parseMcpResult(result);
    expect(parsed.tasks).toBeTruthy();
    expect(parsed.escalations).toBeTruthy();
    expect(parsed.active_workflow_types).toBeDefined();
    expect(parsed.recent_activity).toBeDefined();
    expect(parsed.recent_activity.tasks_created_24h).toBeGreaterThanOrEqual(0);
  });

  // ── get_escalation_stats ────────────────────────────────────────────

  it('should return escalation statistics', async () => {
    const result = await mcpClient.callTool({
      name: 'get_escalation_stats',
      arguments: {},
    });

    const parsed = parseMcpResult(result);
    expect(parsed.pending).toBeGreaterThanOrEqual(0);
  });

  // ── get_process_summary ─────────────────────────────────────────────

  it('should return process summaries', async () => {
    const result = await mcpClient.callTool({
      name: 'get_process_summary',
      arguments: { limit: 10 },
    });

    const parsed = parseMcpResult(result);
    expect(parsed.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(parsed.processes)).toBe(true);
  });
});
