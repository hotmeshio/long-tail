import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { start } from '../start';
import { createDbServer, stopDbServer } from '../services/mcp/db-server';
import { parseJsonResponse } from '../services/insight/index';
import { loggerRegistry } from '../services/logger';
import { telemetryRegistry } from '../services/telemetry';
import { eventRegistry } from '../services/events';
import { maintenanceRegistry } from '../services/maintenance';
import { mcpRegistry } from '../services/mcp/index';
import type { LTInstance } from '../types/startup';

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

// ── parseJsonResponse tests ───────────────────────────────────────────────

describe('parseJsonResponse', () => {
  it('should parse clean JSON', () => {
    const input = JSON.stringify({
      title: 'Test',
      summary: 'A test summary',
      sections: [],
      metrics: [],
    });
    const result = parseJsonResponse(input);
    expect(result.title).toBe('Test');
    expect(result.summary).toBe('A test summary');
  });

  it('should strip markdown code fences', () => {
    const json = { title: 'Fenced', summary: 'OK', sections: [], metrics: [] };
    const input = '```json\n' + JSON.stringify(json) + '\n```';
    const result = parseJsonResponse(input);
    expect(result.title).toBe('Fenced');
  });

  it('should strip code fences without language tag', () => {
    const json = { title: 'Plain', summary: 'Fine', sections: [], metrics: [] };
    const input = '```\n' + JSON.stringify(json) + '\n```';
    const result = parseJsonResponse(input);
    expect(result.title).toBe('Plain');
  });

  it('should return fallback for malformed JSON', () => {
    const result = parseJsonResponse('This is not JSON at all');
    expect(result.title).toBe('Analysis Complete');
    expect(result.summary).toBe('This is not JSON at all');
    expect(result.sections).toEqual([]);
    expect(result.metrics).toEqual([]);
  });

  it('should return fallback for empty string', () => {
    const result = parseJsonResponse('');
    expect(result.title).toBe('Analysis Complete');
    expect(result.summary).toBe('No response generated.');
  });

  it('should handle whitespace-only input', () => {
    const result = parseJsonResponse('   \n  ');
    expect(result.title).toBe('Analysis Complete');
    expect(result.summary).toBe('No response generated.');
  });
});

// ── Insight activities (tool routing) ─────────────────────────────────────

describe('Insight activities — tool routing', () => {
  let lt: LTInstance;

  beforeAll(async () => {
    clearRegistries();

    lt = await start({
      database: TEST_DB,
      server: { enabled: false },
      maintenance: false,
    });

    // Reset server singleton
    await stopDbServer();
  }, 30_000);

  afterAll(async () => {
    await stopDbServer();
    await lt.shutdown();
    clearRegistries();
  }, 15_000);

  it('should list DB tools in getDbTools', async () => {
    // Import dynamically to get fresh module state
    const { getDbTools } = await import('../services/insight/activities');

    const tools = await getDbTools();

    // DB server has 6 tools
    expect(tools.length).toBeGreaterThanOrEqual(6);

    const names = tools.map((t) => t.function.name);
    // DB tools
    expect(names).toContain('find_tasks');
    expect(names).toContain('find_escalations');
    expect(names).toContain('get_system_health');

    // Each tool should have OpenAI function-calling format
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBeTruthy();
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.parameters).toBeTruthy();
    }
  });

  it('should route DB tool calls to the DB client', async () => {
    const { callDbTool } = await import('../services/insight/activities');

    // Call a DB tool — should work without mocked fetch
    const result = await callDbTool('get_workflow_types', {});
    expect(result).toBeTruthy();
    expect(Array.isArray(result.workflows) || result.count !== undefined).toBe(true);
  });
});
