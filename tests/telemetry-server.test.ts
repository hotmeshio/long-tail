import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  createTelemetryServer,
  stopTelemetryServer,
} from '../services/mcp/telemetry-server';
import { parseMcpResult } from './setup/mcp';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Telemetry MCP server', () => {
  let mcpClient: InstanceType<typeof McpClient>;
  let originalTeam: string | undefined;
  let originalEnv: string | undefined;
  let originalDataset: string | undefined;

  beforeAll(async () => {
    // Save originals
    originalTeam = process.env.HONEYCOMB_TEAM;
    originalEnv = process.env.HONEYCOMB_ENVIRONMENT;
    originalDataset = process.env.HONEYCOMB_DATASET;

    // Set test values
    process.env.HONEYCOMB_TEAM = 'test-team';
    process.env.HONEYCOMB_ENVIRONMENT = 'test-env';
    process.env.HONEYCOMB_DATASET = 'long-tail';

    // Reset singleton and create server
    await stopTelemetryServer();
    const server = await createTelemetryServer({ name: 'test-telemetry' });

    // Wire up InMemoryTransport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    mcpClient = new McpClient({ name: 'test-telemetry-client', version: '1.0.0' });
    await mcpClient.connect(clientTransport);
  }, 15_000);

  afterAll(async () => {
    await mcpClient.close();
    await stopTelemetryServer();

    // Restore
    if (originalTeam !== undefined) {
      process.env.HONEYCOMB_TEAM = originalTeam;
    } else {
      delete process.env.HONEYCOMB_TEAM;
    }
    if (originalEnv !== undefined) {
      process.env.HONEYCOMB_ENVIRONMENT = originalEnv;
    } else {
      delete process.env.HONEYCOMB_ENVIRONMENT;
    }
    if (originalDataset !== undefined) {
      process.env.HONEYCOMB_DATASET = originalDataset;
    } else {
      delete process.env.HONEYCOMB_DATASET;
    }
  }, 10_000);

  // ── Tool discovery ──────────────────────────────────────────────────

  it('should discover 1 registered tool via listTools()', async () => {
    const { tools } = await mcpClient.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_trace_link');
    expect(tools).toHaveLength(1);
  });

  // ── get_trace_link ────────────────────────────────────────────────

  it('should generate a Honeycomb UI trace link', async () => {
    const traceId = 'abc123def456';

    const result = await mcpClient.callTool({
      name: 'get_trace_link',
      arguments: { trace_id: traceId },
    });

    const parsed = parseMcpResult(result);
    expect(parsed.trace_id).toBe(traceId);
    expect(parsed.dataset).toBe('long-tail');
    expect(parsed.honeycomb_url).toBe(
      'https://ui.honeycomb.io/test-team/environments/test-env/datasets/long-tail/trace?trace_id=abc123def456',
    );
  });

  it('should include span_id in the link when provided', async () => {
    const result = await mcpClient.callTool({
      name: 'get_trace_link',
      arguments: { trace_id: 'trace-001', span_id: 'span-abc' },
    });

    const parsed = parseMcpResult(result);
    expect(parsed.honeycomb_url).toContain('trace_id=trace-001');
    expect(parsed.honeycomb_url).toContain('span=span-abc');
  });

  it('should use custom dataset when provided', async () => {
    const result = await mcpClient.callTool({
      name: 'get_trace_link',
      arguments: { trace_id: 'trace-002', dataset: 'custom-dataset' },
    });

    const parsed = parseMcpResult(result);
    expect(parsed.dataset).toBe('custom-dataset');
    expect(parsed.honeycomb_url).toContain('/datasets/custom-dataset/');
  });
});

// ── Separate describe for missing config ──────────────────────────────────

describe('Telemetry MCP server (no team/environment)', () => {
  let mcpClient: InstanceType<typeof McpClient>;
  let originalTeam: string | undefined;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    originalTeam = process.env.HONEYCOMB_TEAM;
    originalEnv = process.env.HONEYCOMB_ENVIRONMENT;
    delete process.env.HONEYCOMB_TEAM;
    delete process.env.HONEYCOMB_ENVIRONMENT;

    await stopTelemetryServer();
    const server = await createTelemetryServer({ name: 'test-telemetry-noconfig' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    mcpClient = new McpClient({ name: 'test-noconfig-client', version: '1.0.0' });
    await mcpClient.connect(clientTransport);
  }, 15_000);

  afterAll(async () => {
    await mcpClient.close();
    await stopTelemetryServer();
    if (originalTeam !== undefined) {
      process.env.HONEYCOMB_TEAM = originalTeam;
    }
    if (originalEnv !== undefined) {
      process.env.HONEYCOMB_ENVIRONMENT = originalEnv;
    }
  }, 10_000);

  it('should return error when HONEYCOMB_TEAM and HONEYCOMB_ENVIRONMENT are not set', async () => {
    const result = await mcpClient.callTool({
      name: 'get_trace_link',
      arguments: { trace_id: 'any-trace' },
    });

    expect(result.isError).toBe(true);
    const parsed = parseMcpResult(result);
    expect(parsed.error).toMatch(/HONEYCOMB_TEAM/i);
    expect(parsed.error).toMatch(/HONEYCOMB_ENVIRONMENT/i);
  });
});
