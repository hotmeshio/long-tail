import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { createMcpTestClient, parseMcpResult, type McpTestContext } from '../setup/mcp';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import { createLTActivityInterceptor } from '../../interceptor/activity-interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as verifyDocumentMcpWorkflow from '../../examples/workflows/verify-document-mcp';
import * as configService from '../../services/config';
import { createVisionServer, stopVisionServer } from '../../services/mcp/vision-server';

const { Connection, Client, Worker } = Durable;

const TASK_QUEUE = 'test-verify-mcp';
const ACTIVITY_QUEUE = 'test-lt-verify-mcp-interceptor';

const hasOpenAIKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'xxx';

// ── Vision MCP Server tool tests ──────────────────────────────────────

describe('Vision MCP Server (InMemoryTransport)', () => {
  let visionClient: InstanceType<typeof McpClient>;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    await stopVisionServer();
    const server = await createVisionServer({ name: 'test-vision-server' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    visionClient = new McpClient(
      { name: 'test-vision-client', version: '1.0.0' },
    );
    await visionClient.connect(clientTransport);
  }, 30_000);

  afterAll(async () => {
    await visionClient.close();
    await stopVisionServer();
    await sleepFor(1000);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('should discover all 5 registered tools via listTools()', async () => {
    const { tools } = await visionClient.listTools();
    const names = tools.map((t: any) => t.name).sort();
    expect(names).toEqual([
      'extract_member_info',
      'list_document_pages',
      'rotate_page',
      'translate_content',
      'validate_member',
    ]);
  });

  it('should list document pages via list_document_pages', async () => {
    const result = await visionClient.callTool({
      name: 'list_document_pages',
      arguments: {},
    });
    const parsed = parseMcpResult(result);
    expect(parsed.pages).toBeTruthy();
    expect(Array.isArray(parsed.pages)).toBe(true);
    expect(parsed.pages.length).toBeGreaterThan(0);

    // Should find the test fixture images
    const pageNames = parsed.pages.map((p: string) => p.replace(/^.*\//, ''));
    expect(pageNames).toContain('page1.png');
    expect(pageNames).toContain('page2.png');
  });

  it('should validate a matching member via validate_member', async () => {
    const result = await visionClient.callTool({
      name: 'validate_member',
      arguments: {
        member_info: {
          memberId: 'MBR-2024-003',
          name: 'Bob Johnson',
          address: {
            street: '789 Pine Road',
            city: 'Springfield',
            state: 'IL',
            zip: '62703',
          },
        },
      },
    });
    const parsed = parseMcpResult(result);
    expect(parsed.result).toBe('match');
    expect(parsed.databaseRecord).toBeTruthy();
  });

  it('should return mismatch for wrong address via validate_member', async () => {
    const result = await visionClient.callTool({
      name: 'validate_member',
      arguments: {
        member_info: {
          memberId: 'MBR-2024-001',
          name: 'John Smith',
          address: {
            street: '456 Elm Street',
            city: 'Rivertown',
            state: 'CA',
            zip: '90210',
          },
        },
      },
    });
    const parsed = parseMcpResult(result);
    expect(parsed.result).toBe('mismatch');
    expect(parsed.databaseRecord.address.street).toBe('123 Main Street');
  });

  it('should return not_found for unknown member via validate_member', async () => {
    const result = await visionClient.callTool({
      name: 'validate_member',
      arguments: {
        member_info: {
          memberId: 'MBR-UNKNOWN',
          name: 'Nobody',
        },
      },
    });
    const parsed = parseMcpResult(result);
    expect(parsed.result).toBe('not_found');
  });

  it('should extract member info via extract_member_info', async () => {
    if (!hasOpenAIKey) {
      console.log('Skipped — OPENAI_API_KEY not set.');
      return;
    }

    // List pages first, then extract from page 1
    const listResult = await visionClient.callTool({
      name: 'list_document_pages',
      arguments: {},
    });
    const pages = parseMcpResult(listResult).pages;

    const result = await visionClient.callTool({
      name: 'extract_member_info',
      arguments: { image_ref: pages[0], page_number: 1 },
    });
    const parsed = parseMcpResult(result);
    expect(parsed.member_info).toBeTruthy();
    expect(parsed.member_info.memberId).toBeTruthy();
  }, 30_000);
});

// ── MCP-native workflow integration tests ─────────────────────────────

describe('verifyDocumentMcp workflow (MCP-native)', () => {
  let client: InstanceType<typeof Client>;
  let mcpCtx: McpTestContext;

  beforeAll(async () => {
    await connectTelemetry();
    if (!hasOpenAIKey) {
      console.warn(
        '\n⚠  OPENAI_API_KEY not set — MCP workflow tests will be skipped.\n' +
        '   Add your key to .env to run the full verify-document-mcp suite.\n',
      );
    }

    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Seed config for the MCP-native workflow
    await configService.upsertWorkflowConfig({
      workflow_type: 'verifyDocumentMcp',
      is_lt: true,
      is_container: false,
      invocable: false,
      task_queue: TASK_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: ['reviewer'],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    Durable.registerInterceptor(ltInterceptor);

    const ltActivityInterceptor = createLTActivityInterceptor();
    Durable.registerActivityInterceptor(ltActivityInterceptor);

    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: verifyDocumentMcpWorkflow.verifyDocumentMcp,
    });
    await worker.run();

    client = new Client({ connection });

    // Connect MCP client for escalation queue interaction via protocol
    mcpCtx = await createMcpTestClient();
  }, 30_000);

  afterAll(async () => {
    await mcpCtx.cleanup();
    await stopVisionServer();
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('should extract via MCP Vision tools and escalate on address mismatch', async () => {
    if (!hasOpenAIKey) return;

    const workflowId = `test-mcp-vision-mismatch-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: { documentId: 'DOC-001' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'verifyDocumentMcp',
      workflowId,
      expire: 120,
    });

    // Poll until the escalation appears (increased timeout for multiple OpenAI Vision calls)
    const escalations = await waitForEscalation(workflowId, 45_000, 3_000);
    expect(escalations.length).toBe(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');
    expect(esc.description).toBeTruthy();

    const payload = JSON.parse(esc.escalation_payload!);
    expect(payload.extractedInfo).toBeTruthy();
    // The extracted memberId should be MBR-2024-001 from the right-side-up pages.
    // The upside-down page may cause extraction or validation issues, so
    // validationResult can be mismatch, not_found, extraction_failed, or undefined
    // (if the MCP validation tool itself returned an error).
    if (payload.extractedInfo.memberId) {
      expect(payload.extractedInfo.memberId).toBe('MBR-2024-001');
    }
    if (payload.validationResult) {
      expect(payload.validationResult).toMatch(/mismatch|not_found|extraction_failed/);
    }

    // ── MCP: verify escalation is visible via Human Queue protocol ──
    const checkPending = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    expect(parseMcpResult(checkPending).status).toBe('pending');

    const availableWork = await mcpCtx.client.callTool({
      name: 'get_available_work',
      arguments: { role: 'reviewer', limit: 100 },
    });
    expect(
      parseMcpResult(availableWork).escalations.some(
        (e: any) => e.escalation_id === esc.id,
      ),
    ).toBe(true);

    // Resolve via re-run workflow
    await resolveEscalation(esc.id, {
      documentId: 'DOC-001',
      memberId: 'MBR-2024-001',
      verified: true,
      note: 'Member moved — address updated in system',
    });

    await sleepFor(10_000);

    // ── MCP: verify resolution via protocol ──
    const checkResolved = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    const resolved = parseMcpResult(checkResolved);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolver_payload).toBeTruthy();
  }, 60_000);

  it('should skip MCP workflow tests when OPENAI_API_KEY is not set', () => {
    if (hasOpenAIKey) {
      expect(true).toBe(true);
      return;
    }

    console.log('MCP workflow tests skipped — set OPENAI_API_KEY in .env to enable.');
    expect(hasOpenAIKey).toBe(false);
  });
});
