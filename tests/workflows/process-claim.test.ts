import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalationByOriginId } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { createMcpTestClient, parseMcpResult, type McpTestContext } from '../setup/mcp';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import { createLTActivityInterceptor } from '../../interceptor/activity-interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import { executeLT } from '../../orchestrator';
import * as configService from '../../services/config';
import * as taskService from '../../services/task';
import * as mcpDbService from '../../services/mcp/db';
import { escalationStrategyRegistry } from '../../services/escalation-strategy';
import { McpEscalationStrategy } from '../../services/escalation-strategy/mcp';
import { createVisionServer, stopVisionServer } from '../../services/mcp/vision-server';
import { registerBuiltinServer } from '../../services/mcp/client';

import type { LTEnvelope, LTReturn, LTEscalation } from '../../types';

// ── Real workflow + activities ───────────────────────────────────────────────

import * as processClaimWorkflow from '../../examples/workflows/process-claim';
import * as mcpTriageWorkflow from '../../examples/workflows/mcp-triage';
import * as mcpTriageOrchWorkflow from '../../examples/workflows/mcp-triage/orchestrator';

const { Connection, Client, Worker } = Durable;

const CLAIM_QUEUE = 'test-claim';
const ORCH_QUEUE = 'test-claim-orch';
const TRIAGE_QUEUE = 'lt-mcp-triage';
const TRIAGE_ORCH_QUEUE = 'lt-mcp-triage-orch';
const ACTIVITY_QUEUE = 'lt-interceptor';

// ── Test orchestrator: thin container wrapping processClaim ──────────────

async function testProcessClaimOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'processClaim',
    args: [envelope],
    taskQueue: CLAIM_QUEUE,
  });
}

// ── Test suite ──────────────────────────────────────────────────────────

describe('Process Claim → MCP Triage (image orientation)', () => {
  let client: InstanceType<typeof Client>;
  let mcpCtx: McpTestContext;

  beforeAll(async () => {
    await connectTelemetry();

    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Seed MCP server record so getAvailableTools() finds vision tools
    const visionServer = await mcpDbService.createMcpServer({
      name: 'long-tail-document-vision',
      description: 'Document vision tools for page analysis and manipulation',
      transport_type: 'stdio',
      transport_config: { command: 'builtin' },
      auto_connect: false,
      metadata: { category: 'document_processing', builtin: true },
    });
    await mcpDbService.updateMcpServerStatus(visionServer.id, 'connected', [
      { name: 'list_document_pages', description: 'List available document page images from storage.', inputSchema: { type: 'object', properties: {} } },
      { name: 'extract_member_info', description: 'Extract member information from a document page image using OpenAI Vision.', inputSchema: { type: 'object', properties: { image_ref: { type: 'string' }, page_number: { type: 'integer' } }, required: ['image_ref', 'page_number'] } },
      { name: 'validate_member', description: 'Validate extracted member information against the member database.', inputSchema: { type: 'object', properties: { member_info: { type: 'object' } }, required: ['member_info'] } },
      { name: 'rotate_page', description: 'Rotate a document page image by the given degrees.', inputSchema: { type: 'object', properties: { image_ref: { type: 'string' }, degrees: { type: 'integer' } }, required: ['image_ref', 'degrees'] } },
      { name: 'translate_content', description: 'Translate content text to the target language using OpenAI.', inputSchema: { type: 'object', properties: { content: { type: 'string' }, target_language: { type: 'string' } }, required: ['content', 'target_language'] } },
    ]);

    // Seed workflow configs
    await configService.upsertWorkflowConfig({
      workflow_type: 'processClaim',
      is_lt: true,
      is_container: false,
      invocable: false,
      task_queue: CLAIM_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: 'Test process claim (deterministic activities)',
      roles: ['reviewer', 'engineer'],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });

    await configService.upsertWorkflowConfig({
      workflow_type: 'testProcessClaimOrchestrator',
      is_lt: true,
      is_container: true,
      invocable: false,
      task_queue: ORCH_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: 'Test orchestrator for process claim',
      roles: ['reviewer'],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });

    await configService.upsertWorkflowConfig({
      workflow_type: 'mcpTriageOrchestrator',
      is_lt: true,
      is_container: true,
      invocable: false,
      task_queue: TRIAGE_ORCH_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: 'MCP triage orchestrator',
      roles: ['reviewer'],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });

    await configService.upsertWorkflowConfig({
      workflow_type: 'mcpTriage',
      is_lt: true,
      is_container: false,
      invocable: false,
      task_queue: TRIAGE_QUEUE,
      default_role: 'engineer',
      default_modality: 'default',
      description: 'MCP triage leaf',
      roles: ['reviewer', 'engineer'],
      invocation_roles: [],
      lifecycle: { onBefore: [], onAfter: [] },
      consumes: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    // Register interceptor activity worker
    await Durable.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    Durable.registerInterceptor(ltInterceptor);
    Durable.registerActivityInterceptor(createLTActivityInterceptor());

    // Create workers for all queues
    const claimWorker = await Worker.create({
      connection,
      taskQueue: CLAIM_QUEUE,
      workflow: processClaimWorkflow.processClaim,
    });
    await claimWorker.run();

    const orchWorker = await Worker.create({
      connection,
      taskQueue: ORCH_QUEUE,
      workflow: testProcessClaimOrchestrator,
    });
    await orchWorker.run();

    const triageWorker = await Worker.create({
      connection,
      taskQueue: TRIAGE_QUEUE,
      workflow: mcpTriageWorkflow.mcpTriage,
    });
    await triageWorker.run();

    const triageOrchWorker = await Worker.create({
      connection,
      taskQueue: TRIAGE_ORCH_QUEUE,
      workflow: mcpTriageOrchWorkflow.mcpTriageOrchestrator,
    });
    await triageOrchWorker.run();

    client = new Client({ connection });

    // Register MCP escalation strategy
    escalationStrategyRegistry.register(new McpEscalationStrategy());

    // Register builtin server factory so resolveClient can auto-connect
    registerBuiltinServer('long-tail-document-vision', createVisionServer);

    // Connect MCP test client
    mcpCtx = await createMcpTestClient();
  }, 60_000);

  afterAll(async () => {
    await mcpCtx.cleanup();
    escalationStrategyRegistry.clear();
    await stopVisionServer();
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Test 1: Full triage flow with real fixture images ──────────────
  //
  // Uses page1_upside_down.png (real upside-down scan) + page2.png.
  // OpenAI Vision detects the upside-down page → low confidence → escalation.
  // Triage rotates it with sharp → re-runs → auto-approves.

  it('should escalate, triage with image rotation, and complete original flow', async () => {
    const workflowId = `test-claim-e2e-${Durable.guid()}`;

    // 1. Start the orchestrator with upside-down document
    await client.workflow.start({
      args: [{
        data: {
          claimId: 'CLM-TEST-001',
          claimantId: 'MBR-2024-001',
          claimType: 'auto_collision',
          amount: 8500,
          documents: ['page1_upside_down.png', 'page2.png'],
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testProcessClaimOrchestrator',
      workflowId,
      expire: 300,
    });

    // 2. Wait for escalation (analysis flags the upside-down page)
    const escalations = await waitForEscalationByOriginId(workflowId, 45_000, 2_000);
    expect(escalations.length).toBeGreaterThanOrEqual(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');

    // Verify escalation contains claim analysis failure context
    const payload = JSON.parse(esc.escalation_payload!);
    expect(payload.claimId).toBe('CLM-TEST-001');
    expect(payload.analysis.confidence).toBeLessThan(0.85);
    expect(payload.analysis.flags.length).toBeGreaterThan(0);
    expect(payload.documents).toEqual(['page1_upside_down.png', 'page2.png']);

    // 3. MCP: verify escalation is visible via protocol
    const checkPending = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    expect(parseMcpResult(checkPending).status).toBe('pending');

    // 4. Resolve with needsTriage → triggers MCP triage orchestrator
    await resolveEscalation(esc.id, {
      _lt: { needsTriage: true },
      notes: 'Page 1 appears to be scanned upside down. Cannot read member ID or address.',
    });

    // 5. Wait for triage to rotate documents + re-invoke + complete.
    // This involves multiple OpenAI calls (triage LLM loop + Vision on re-run).
    await sleepFor(45_000);

    // 6. Verify the original escalation was resolved
    const checkResolved = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    const resolvedData = parseMcpResult(checkResolved);
    expect(resolvedData.status).toBe('resolved');
    expect(resolvedData.resolver_payload._lt.triaged).toBe(true);

    // 7. Verify task chain shows triage workflow ran
    const { tasks } = await taskService.listTasks({ limit: 100 });
    const triageTasks = tasks.filter(t =>
      t.workflow_type === 'mcpTriageOrchestrator' ||
      t.workflow_type === 'mcpTriage',
    );
    expect(triageTasks.length).toBeGreaterThanOrEqual(1);

    // 8. Verify a re-invoked processClaim exists (from triage Phase 2)
    const claimTasks = tasks.filter(t =>
      t.workflow_type === 'processClaim' &&
      t.created_at > esc.created_at,
    );
    expect(claimTasks.length).toBeGreaterThanOrEqual(1);
  }, 180_000);

  // ── Test 2: Standard re-run when needsTriage is not set ────────────────

  it('should fall through to standard re-run without triage', async () => {
    const workflowId = `test-claim-fallthrough-${Durable.guid()}`;

    // Start the orchestrator with upside-down document
    await client.workflow.start({
      args: [{
        data: {
          claimId: 'CLM-TEST-002',
          claimantId: 'MBR-2024-001',
          claimType: 'property_damage',
          amount: 3200,
          documents: ['page1_upside_down.png'],
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testProcessClaimOrchestrator',
      workflowId,
      expire: 300,
    });

    // Wait for escalation (Vision API can be slow)
    const escalations = await waitForEscalationByOriginId(workflowId, 60_000, 2_000);
    expect(escalations.length).toBeGreaterThanOrEqual(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');

    // Resolve WITHOUT needsTriage — standard re-run
    await resolveEscalation(esc.id, {
      approved: true,
      status: 'resolved',
      analysis: { confidence: 0.95, flags: [], summary: 'Manually verified.' },
    });

    await sleepFor(10_000);

    // Verify the escalation is resolved via standard path
    const checkResolved = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    const resolvedData = parseMcpResult(checkResolved);
    expect(resolvedData.status).toBe('resolved');

    // No triage marker — this was a standard re-run
    expect(resolvedData.resolver_payload._lt).toBeUndefined();
  }, 90_000);

  // ── Test 3: Happy path with readable documents (no escalation) ─────────

  it('should auto-approve when documents are readable', async () => {
    const workflowId = `test-claim-happy-${Durable.guid()}`;

    // Start with properly-oriented documents (page1.png is right-side up)
    await client.workflow.start({
      args: [{
        data: {
          claimId: 'CLM-TEST-003',
          claimantId: 'MBR-2024-001',
          claimType: 'auto_collision',
          amount: 5000,
          documents: ['page1.png', 'page2.png'],
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testProcessClaimOrchestrator',
      workflowId,
      expire: 300,
    });

    // Wait for workflow to complete (no escalation expected)
    await sleepFor(15_000);

    // Verify the claim task completed successfully
    const { tasks } = await taskService.listTasks({ origin_id: workflowId, limit: 10 });
    const claimTask = tasks.find(t => t.workflow_type === 'processClaim');
    expect(claimTask).toBeTruthy();
    expect(claimTask!.status).toBe('completed');
  }, 60_000);
});
