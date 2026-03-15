import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';
import * as fs from 'fs';
import * as path from 'path';

import { postgres_options, sleepFor, waitForEscalationByOriginId } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { createMcpTestClient, parseMcpResult, type McpTestContext } from '../setup/mcp';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../services/interceptor';
import { createLTActivityInterceptor } from '../../services/interceptor/activity-interceptor';
import * as interceptorActivities from '../../services/interceptor/activities';
import { executeLT } from '../../services/orchestrator';
import * as configService from '../../services/config';
import * as taskService from '../../services/task';
import { escalationStrategyRegistry } from '../../services/escalation-strategy';
import { McpEscalationStrategy } from '../../services/escalation-strategy/mcp';
import { stopVisionServer } from '../../services/mcp/vision-server';

import type { LTEnvelope, LTReturn, LTEscalation } from '../../types';
import type { MemberInfo } from '../../examples/workflows/verify-document/types';

// ── MCP triage workflow + activities (real) ──────────────────────────────────

import * as mcpTriageWorkflow from '../../system/workflows/mcp-triage';

const { Connection, Client, Worker } = Durable;

const VERIFY_QUEUE = 'test-triage-verify';
const ORCH_QUEUE = 'test-triage-orch';
const TRIAGE_QUEUE = 'lt-mcp-triage';
const ACTIVITY_QUEUE = 'lt-interceptor';

// ── Mock activities for testVerifyDocument ──────────────────────────────────
// These replace the real OpenAI Vision calls with deterministic behavior:
// - page1_upside_down.png → returns null (simulates upside-down/unreadable page)
// - page1_upside_down_rotated.png → returns valid MemberInfo matching database
// - page1.png → returns valid MemberInfo (normal orientation)
// - page2.png → returns partial info (emergency contact)

async function mockListDocumentPages(): Promise<string[]> {
  // Simulate a document set with an upside-down page (like the real claim scenario).
  // Only return the upside-down page + page2 — not the right-side-up page1.png.
  const dir = path.join(__dirname, '..', 'fixtures');
  return fs.readdirSync(dir)
    .filter(f => (f.endsWith('.png') || f.endsWith('.jpg'))
      && !f.includes('_rotated')
      && f !== 'page1.png')
    .map(f => f);
}

async function mockExtractMemberInfo(
  imageRef: string,
  _pageNumber: number,
): Promise<MemberInfo | null> {
  // Simulates upside-down page — extraction returns nothing
  if (imageRef === 'page1_upside_down.png') return null;

  // Rotated page extracts correctly — matches MBR-2024-001 in database
  if (imageRef.includes('_rotated') || imageRef === 'page1.png') {
    return {
      memberId: 'MBR-2024-001',
      name: 'John Smith',
      address: {
        street: '123 Main Street',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
      },
    };
  }

  // Page 2 has partial info (emergency contact)
  if (imageRef === 'page2.png') {
    return {
      isPartialInfo: true,
      emergencyContact: { name: 'Jane Smith', phone: '555-0102' },
    };
  }

  return null;
}

async function mockValidateMember(
  memberInfo: MemberInfo,
): Promise<{ result: 'match' | 'mismatch' | 'not_found'; databaseRecord?: Record<string, any> }> {
  const dbPath = path.join(__dirname, '..', 'fixtures', 'member-database.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const record = db.members[memberInfo.memberId!];

  if (!record) return { result: 'not_found' };

  if (memberInfo.address && record.address) {
    const a = memberInfo.address;
    const b = record.address;
    const addressMatch =
      a.street === b.street &&
      a.city === b.city &&
      a.state === b.state &&
      a.zip === b.zip;
    if (!addressMatch) return { result: 'mismatch', databaseRecord: record };
  }

  if (record.status !== 'active') return { result: 'mismatch', databaseRecord: record };

  return { result: 'match', databaseRecord: record };
}

// ── Test workflow: same logic as verifyDocument but with mock activities ────

const mockActivities = {
  mockListDocumentPages,
  mockExtractMemberInfo,
  mockValidateMember,
};

const {
  mockListDocumentPages: listPages,
  mockExtractMemberInfo: extractInfo,
  mockValidateMember: validateMbr,
} = Durable.workflow.proxyActivities<typeof mockActivities>({
  activities: mockActivities,
  retryPolicy: { maximumAttempts: 2 },
});

async function testVerifyDocument(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  const { documentId } = envelope.data;

  // Re-run with human-provided resolver data
  if (envelope.resolver) {
    return {
      type: 'return',
      milestones: [{ name: 'extraction', value: 'human_resolved' }],
      data: { documentId, ...envelope.resolver },
    };
  }

  // Support corrected pages from triage orchestrator
  const pages: string[] = envelope.data.pages || await listPages();

  // Extract info from each page
  const extractions: MemberInfo[] = [];
  for (let i = 0; i < pages.length; i++) {
    const info = await extractInfo(pages[i], i + 1);
    if (info) extractions.push(info);
  }

  if (extractions.length === 0) {
    return {
      type: 'escalation',
      data: {
        documentId,
        extractedInfo: {},
        validationResult: 'extraction_failed',
        reason: 'Vision API could not extract any member information from the document.',
      },
      message: 'Document extraction failed — no data could be read from the images.',
      role: 'reviewer',
    };
  }

  // Merge extractions (primary + partial pages)
  const primary = extractions.find(e => !e.isPartialInfo) || extractions[0];
  const merged: MemberInfo = { ...primary };
  for (const partial of extractions.filter(e => e.isPartialInfo)) {
    if (partial.emergencyContact) merged.emergencyContact = partial.emergencyContact;
    if (partial.phone && !merged.phone) merged.phone = partial.phone;
    if (partial.email && !merged.email) merged.email = partial.email;
  }

  // Validate
  const validation = await validateMbr(merged);

  if (validation.result === 'match') {
    return {
      type: 'return',
      milestones: [
        { name: 'pages_processed', value: pages.length },
        { name: 'extraction', value: 'success' },
        { name: 'validation', value: 'match' },
      ],
      data: {
        documentId,
        memberId: merged.memberId!,
        extractedInfo: merged,
        validationResult: 'match',
        confidence: 1.0,
      },
    };
  }

  const reason =
    validation.result === 'not_found'
      ? `Member ${merged.memberId || '(unknown)'} not found in database.`
      : `Address mismatch for ${merged.memberId}.`;

  return {
    type: 'escalation',
    data: {
      documentId,
      extractedInfo: merged,
      validationResult: validation.result,
      databaseRecord: validation.databaseRecord,
      reason,
    },
    message: reason,
    role: 'reviewer',
  };
}

// ── Test orchestrator: thin container wrapping testVerifyDocument ────────

async function testVerifyDocumentOrchestrator(envelope: LTEnvelope) {
  return await executeLT({
    workflowName: 'testVerifyDocument',
    args: [envelope],
    taskQueue: VERIFY_QUEUE,
  });
}

// ── Test suite ──────────────────────────────────────────────────────────

describe('MCP Triage Orchestrator (dynamic escalation)', () => {
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
      workflow_type: 'testVerifyDocument',
      is_lt: true,
      is_container: false,
      invocable: false,
      task_queue: VERIFY_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: 'Test verify document (mock activities)',
      roles: ['reviewer'],
      invocation_roles: [],
      consumes: [],
    });

    await configService.upsertWorkflowConfig({
      workflow_type: 'testVerifyDocumentOrchestrator',
      is_lt: true,
      is_container: true,
      invocable: false,
      task_queue: ORCH_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: 'Test orchestrator for verify document',
      roles: ['reviewer'],
      invocation_roles: [],
      consumes: [],
    });

    await configService.upsertWorkflowConfig({
      workflow_type: 'mcpTriage',
      is_lt: true,
      is_container: false, // Leaf — can escalate to engineer for guidance
      invocable: false,
      task_queue: TRIAGE_QUEUE,
      default_role: 'engineer',
      default_modality: 'default',
      description: 'MCP triage leaf — remediates via MCP tools or engineer guidance',
      roles: ['reviewer', 'engineer'],
      invocation_roles: [],
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
    const verifyWorker = await Worker.create({
      connection,
      taskQueue: VERIFY_QUEUE,
      workflow: testVerifyDocument,
    });
    await verifyWorker.run();

    const orchWorker = await Worker.create({
      connection,
      taskQueue: ORCH_QUEUE,
      workflow: testVerifyDocumentOrchestrator,
    });
    await orchWorker.run();

    const triageWorker = await Worker.create({
      connection,
      taskQueue: TRIAGE_QUEUE,
      workflow: mcpTriageWorkflow.mcpTriage,
    });
    await triageWorker.run();

    client = new Client({ connection });

    // Register MCP escalation strategy
    escalationStrategyRegistry.register(new McpEscalationStrategy());

    // Connect MCP test client
    mcpCtx = await createMcpTestClient();
  }, 30_000);

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

  // ── Test 1: Full triage flow ──────────────────────────────────────────────
  //
  // 1. Start orchestrator → testVerifyDocument extracts from page1.png → null
  // 2. Workflow escalates (extraction_failed)
  // 3. Human resolves with needsTriage (no hint — just describes the problem)
  // 4. MCP strategy → starts mcpTriage
  // 5. LLM-driven triage: diagnoses issue using Vision tools, rotates pages,
  //    verifies extraction, returns corrected data
  // 6. Triage re-invokes testVerifyDocument with corrected pages
  // 7. Extraction succeeds → validation passes → signals back
  // 8. Original orchestrator completes

  it('should extract, escalate, triage, remediate, and signal back', async () => {
    const workflowId = `test-triage-e2e-${Durable.guid()}`;

    // 1. Start the orchestrator
    await client.workflow.start({
      args: [{ data: { documentId: 'DOC-TRIAGE-001' }, metadata: {} }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testVerifyDocumentOrchestrator',
      workflowId,
      expire: 300,
    });

    // 2. Wait for escalation (mock extraction fails on page1.png)
    const escalations = await waitForEscalationByOriginId(workflowId, 15_000, 1_000);
    expect(escalations.length).toBeGreaterThanOrEqual(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');
    expect(esc.description).toBeTruthy();

    // Verify escalation contains failure context
    // page1.png returns null (upside-down), page2.png returns partial info
    // with no memberId, so validation returns 'not_found'
    const payload = JSON.parse(esc.escalation_payload!);
    expect(payload.validationResult).toBe('not_found');

    // 3. MCP: verify escalation is visible via protocol
    const checkPending = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    expect(parseMcpResult(checkPending).status).toBe('pending');

    // 4. Resolve with needsTriage — triggers MCP triage orchestrator
    //    No hint needed — the LLM diagnoses the issue using MCP tools
    await resolveEscalation(esc.id, {
      _lt: { needsTriage: true },
      notes: 'Document images appear to be upside down or damaged. Cannot read member information from the scanned pages.',
    });

    // 5. Wait for the full triage chain to complete
    // Triage: query upstream → rotate pages → re-invoke → signal back
    await sleepFor(20_000);

    // 6. Verify the escalation was resolved
    const checkResolved = await mcpCtx.client.callTool({
      name: 'check_resolution',
      arguments: { escalation_id: esc.id },
    });
    const resolvedData = parseMcpResult(checkResolved);
    expect(resolvedData.status).toBe('resolved');

    // Verify the resolver payload contains triage marker
    expect(resolvedData.resolver_payload._lt.triaged).toBe(true);
    expect(resolvedData.resolver_payload._lt.triageWorkflowId).toBeTruthy();

    // 7. Verify task chain in the database
    // There should be tasks for: testVerifyDocument (original, failed),
    // mcpTriage, and testVerifyDocument (re-invoked, succeeded)
    const { tasks } = await taskService.listTasks({ limit: 100 });
    const triageTasks = tasks.filter(t =>
      t.workflow_type === 'mcpTriage',
    );
    expect(triageTasks.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // ── Test 2: Standard re-run when needsTriage is not set ───────────────────

  it('should fall through to standard re-run when needsTriage is not set', async () => {
    const workflowId = `test-triage-fallthrough-${Durable.guid()}`;

    // Start the orchestrator
    await client.workflow.start({
      args: [{ data: { documentId: 'DOC-TRIAGE-002' }, metadata: {} }],
      taskQueue: ORCH_QUEUE,
      workflowName: 'testVerifyDocumentOrchestrator',
      workflowId,
      expire: 300,
    });

    // Wait for escalation
    const escalations = await waitForEscalationByOriginId(workflowId, 15_000, 1_000);
    expect(escalations.length).toBeGreaterThanOrEqual(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');

    // Resolve WITHOUT needsTriage — standard re-run
    await resolveEscalation(esc.id, {
      documentId: 'DOC-TRIAGE-002',
      memberId: 'MBR-2024-001',
      verified: true,
      note: 'Manually verified — address updated in system',
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
  }, 30_000);
});
