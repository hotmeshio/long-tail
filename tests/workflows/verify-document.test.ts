import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { MemFlow } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor } from '../setup';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as verifyDocumentWorkflow from '../../workflows/verify-document';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import type { LTReturn } from '../../types';

const { Connection, Client, Worker } = MemFlow;

const TASK_QUEUE = 'test-verify';
const ACTIVITY_QUEUE = 'test-lt-verify-interceptor';

const hasOpenAIKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'xxx';

describe('verifyDocument workflow (OpenAI Vision)', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    if (!hasOpenAIKey) {
      console.warn(
        '\n⚠  OPENAI_API_KEY not set — vision tests will be skipped.\n' +
        '   Add your key to .env to run the full verify-document suite.\n',
      );
    }

    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Seed config so the config-driven interceptor recognizes this workflow
    await configService.upsertWorkflowConfig({
      workflow_type: 'verifyDocument',
      is_lt: true,
      is_container: false,
      task_queue: TASK_QUEUE,
      default_role: 'reviewer',
      default_modality: 'default',
      description: null,
      roles: ['reviewer'],
      lifecycle: { onBefore: [], onAfter: [] },
      consumers: [],
    });

    const connection = { class: Postgres, options: postgres_options };

    await MemFlow.registerActivityWorker(
      { connection, taskQueue: ACTIVITY_QUEUE },
      interceptorActivities,
      ACTIVITY_QUEUE,
    );

    const ltInterceptor = createLTInterceptor({
      activityTaskQueue: ACTIVITY_QUEUE,
    });
    MemFlow.registerInterceptor(ltInterceptor);

    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflow: verifyDocumentWorkflow.verifyDocument,
    });
    await worker.run();

    client = new Client({ connection });
  }, 60_000);

  afterAll(async () => {
    MemFlow.clearInterceptors();
    await sleepFor(1500);
    await MemFlow.shutdown();
  }, 10_000);

  // ── Vision: extract → validate → escalate (address mismatch) ─────────────
  //
  // The fixture images contain MBR-2024-001 at 456 Elm Street, Rivertown, CA.
  // The database has MBR-2024-001 at 123 Main Street, Springfield, IL.
  // This mismatch should trigger an escalation.

  it('should extract member info via vision and escalate on address mismatch', async () => {
    if (!hasOpenAIKey) return;

    const workflowId = `test-vision-mismatch-${MemFlow.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: { documentId: 'DOC-001' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'verifyDocument',
      workflowId,
      expire: 120,
    });

    // Vision calls take a few seconds
    await sleepFor(15_000);

    // Verify the task was escalated
    const task = await taskService.getTaskByWorkflowId(workflowId);
    expect(task).toBeTruthy();
    expect(task!.status).toBe('needs_intervention');

    // Verify escalation was created with mismatch details
    const escalations = await escalationService.getEscalationsByTaskId(task!.id);
    expect(escalations.length).toBe(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');
    expect(esc.description).toBeTruthy();

    // The escalation payload should contain the extracted info
    const payload = JSON.parse(esc.escalation_payload!);
    expect(payload.extractedInfo).toBeTruthy();
    expect(payload.extractedInfo.memberId).toBe('MBR-2024-001');
    expect(payload.validationResult).toMatch(/mismatch|not_found/);

    // Human reviews and confirms the correct address
    await handle.signal(`lt-resolve-${workflowId}`, {
      documentId: 'DOC-001',
      memberId: 'MBR-2024-001',
      verified: true,
      note: 'Member moved — address updated in system',
    });

    const result = await handle.result() as LTReturn;
    expect(result.type).toBe('return');
    expect(result.data.verified).toBe(true);
  }, 60_000);

  // ── Vision: escalation payload contains full context for human review ─────

  it('should provide the human reviewer with extracted data and database record', async () => {
    if (!hasOpenAIKey) return;

    const workflowId = `test-vision-context-${MemFlow.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: { documentId: 'DOC-002' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'verifyDocument',
      workflowId,
      expire: 120,
    });

    await sleepFor(15_000);

    const task = await taskService.getTaskByWorkflowId(workflowId);
    const escalations = await escalationService.getEscalationsByTaskId(task!.id);
    const payload = JSON.parse(escalations[0].escalation_payload!);

    // Human reviewer should see:
    // 1. What the AI extracted from the image
    expect(payload.extractedInfo).toBeTruthy();
    expect(payload.extractedInfo.name).toBeTruthy();

    // 2. What the database has (for comparison)
    if (payload.databaseRecord) {
      expect(payload.databaseRecord.address).toBeTruthy();
    }

    // 3. Why it was escalated
    expect(payload.reason).toBeTruthy();

    // Clean up
    await handle.signal(`lt-resolve-${workflowId}`, {
      documentId: 'DOC-002',
      verified: true,
    });
    await handle.result();
  }, 60_000);

  // ── Vision: multi-page extraction merges data ─────────────────────────────

  it('should merge multi-page extractions into a single record', async () => {
    if (!hasOpenAIKey) return;

    const workflowId = `test-vision-merge-${MemFlow.guid()}`;

    const handle = await client.workflow.start({
      args: [{
        data: { documentId: 'DOC-003' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'verifyDocument',
      workflowId,
      expire: 120,
    });

    await sleepFor(15_000);

    // The workflow will escalate (address mismatch), but the extracted data
    // should include info from BOTH pages (page 1: member info, page 2: emergency contact)
    const task = await taskService.getTaskByWorkflowId(workflowId);
    const escalations = await escalationService.getEscalationsByTaskId(task!.id);
    const payload = JSON.parse(escalations[0].escalation_payload!);

    // Page 1 should provide: memberId, name, address
    expect(payload.extractedInfo.memberId).toBe('MBR-2024-001');
    expect(payload.extractedInfo.name).toBeTruthy();

    // Page 2 should provide: emergency contact (merged into the record)
    expect(payload.extractedInfo.emergencyContact).toBeTruthy();

    // Clean up
    await handle.signal(`lt-resolve-${workflowId}`, {
      documentId: 'DOC-003',
      verified: true,
    });
    await handle.result();
  }, 60_000);

  // ── Skipped without key ───────────────────────────────────────────────────

  it('should skip vision tests when OPENAI_API_KEY is not set', () => {
    if (hasOpenAIKey) {
      // This test only matters when the key is absent
      expect(true).toBe(true);
      return;
    }

    console.log('Vision tests skipped — set OPENAI_API_KEY in .env to enable.');
    expect(hasOpenAIKey).toBe(false);
  });
});
