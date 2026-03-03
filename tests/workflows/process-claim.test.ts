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
import { escalationStrategyRegistry } from '../../services/escalation-strategy';
import { McpEscalationStrategy } from '../../services/escalation-strategy/mcp';
import { stopVisionServer } from '../../services/mcp/vision-server';

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

  // ── Test 1: Full triage flow with image_orientation hint ─────────────
  //
  // 1. Start orchestrator → processClaim analyzes documents → low confidence
  // 2. Workflow escalates to reviewer
  // 3. Reviewer resolves with needsTriage + hint: image_orientation
  // 4. MCP strategy → starts mcpTriageOrchestrator
  // 5. Triage reads documents from escalation payload, rotates via MCP
  // 6. Triage re-invokes processClaim with corrected documents (_rotated)
  // 7. Analysis succeeds (confidence 0.92) → validation passes
  // 8. Signal back → original orchestrator completes

  it('should escalate, triage with image rotation, and complete original flow', async () => {
    const workflowId = `test-claim-e2e-${Durable.guid()}`;

    // 1. Start the orchestrator with original (unreadable) documents
    await client.workflow.start({
      args: [{
        data: {
          claimId: 'CLM-TEST-001',
          claimantId: 'POL-TEST-001',
          claimType: 'auto_collision',
          amount: 8500,
          documents: ['incident_report.pdf', 'photo_evidence.jpg'],
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testProcessClaimOrchestrator',
      workflowId,
      expire: 300,
    });

    // 2. Wait for escalation (analysis returns confidence 0.35)
    const escalations = await waitForEscalationByOriginId(workflowId, 30_000, 1_000);
    expect(escalations.length).toBeGreaterThanOrEqual(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');

    // Verify escalation contains claim analysis failure context
    const payload = JSON.parse(esc.escalation_payload!);
    expect(payload.claimId).toBe('CLM-TEST-001');
    expect(payload.analysis.confidence).toBe(0.35);
    expect(payload.analysis.flags).toContain('blurry_images');
    expect(payload.documents).toEqual(['incident_report.pdf', 'photo_evidence.jpg']);

    // 3. MCP: verify escalation is visible via protocol
    const checkPending = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    expect(parseMcpResult(checkPending).status).toBe('pending');

    // 4. Resolve with needsTriage → triggers MCP triage orchestrator
    await resolveEscalation(esc.id, {
      _lt: { needsTriage: true, hint: 'image_orientation' },
      notes: 'Document photos appear upside down, cannot verify claim',
    });

    // 5. Wait for triage to rotate documents + re-invoke + complete
    await sleepFor(20_000);

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

    // 8. Verify a completed processClaim re-run exists (from triage Phase 2)
    const claimTasks = tasks.filter(t =>
      t.workflow_type === 'processClaim' &&
      t.status === 'completed' &&
      t.created_at > esc.created_at,
    );
    expect(claimTasks.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ── Test 2: Standard re-run when needsTriage is not set ────────────────

  it('should fall through to standard re-run without triage', async () => {
    const workflowId = `test-claim-fallthrough-${Durable.guid()}`;

    // Start the orchestrator
    await client.workflow.start({
      args: [{
        data: {
          claimId: 'CLM-TEST-002',
          claimantId: 'POL-TEST-002',
          claimType: 'property_damage',
          amount: 3200,
          documents: ['damage_photo.jpg'],
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testProcessClaimOrchestrator',
      workflowId,
      expire: 300,
    });

    // Wait for escalation
    const escalations = await waitForEscalationByOriginId(workflowId, 30_000, 1_000);
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

  // ── Test 3: Happy path with corrected documents (no escalation) ───────

  it('should auto-approve when documents are pre-corrected', async () => {
    const workflowId = `test-claim-happy-${Durable.guid()}`;

    // Start with already-corrected documents (contain _rotated)
    await client.workflow.start({
      args: [{
        data: {
          claimId: 'CLM-TEST-003',
          claimantId: 'POL-TEST-003',
          claimType: 'auto_collision',
          amount: 5000,
          documents: ['report_rotated.pdf', 'photo_rotated.jpg'],
        },
        metadata: {},
      }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testProcessClaimOrchestrator',
      workflowId,
      expire: 300,
    });

    // Wait for workflow to complete (no escalation expected)
    await sleepFor(8_000);

    // Verify no escalation was created for this workflow
    const { tasks } = await taskService.listTasks({ origin_id: workflowId, limit: 10 });
    const claimTask = tasks.find(t => t.workflow_type === 'processClaim');
    expect(claimTask).toBeTruthy();
    expect(claimTask!.status).toBe('completed');
  }, 60_000);
});
