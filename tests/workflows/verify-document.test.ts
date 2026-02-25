import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options, sleepFor, waitForEscalation } from '../setup';
import { connectTelemetry, disconnectTelemetry } from '../setup/telemetry';
import { resolveEscalation } from '../setup/resolve';
import { migrate } from '../../services/db/migrate';
import { createLTInterceptor } from '../../interceptor';
import { createLTActivityInterceptor } from '../../interceptor/activity-interceptor';
import * as interceptorActivities from '../../interceptor/activities';
import * as verifyDocumentWorkflow from '../../workflows/verify-document';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';

const { Connection, Client, Worker } = Durable;

const TASK_QUEUE = 'test-verify';
const ACTIVITY_QUEUE = 'test-lt-verify-interceptor';

const hasOpenAIKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'xxx';

describe('verifyDocument workflow (OpenAI Vision)', () => {
  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    await connectTelemetry();
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
      workflow: verifyDocumentWorkflow.verifyDocument,
    });
    await worker.run();

    client = new Client({ connection });
  }, 60_000);

  afterAll(async () => {
    Durable.clearInterceptors();
    Durable.clearActivityInterceptors();
    await sleepFor(1500);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Vision: extract → validate → escalate (address mismatch) ─────────────
  //
  // The fixture images contain MBR-2024-001 at 456 Elm Street, Rivertown, CA.
  // The database has MBR-2024-001 at 123 Main Street, Springfield, IL.
  // This mismatch should trigger an escalation.

  it('should extract member info via vision and escalate on address mismatch', async () => {
    if (!hasOpenAIKey) return;

    const workflowId = `test-vision-mismatch-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: { documentId: 'DOC-001' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'verifyDocument',
      workflowId,
      expire: 120,
    });

    // Poll until the escalation appears (vision API timing varies)
    const escalations = await waitForEscalation(workflowId);
    expect(escalations.length).toBe(1);

    const esc = escalations[0];
    expect(esc.status).toBe('pending');
    expect(esc.description).toBeTruthy();

    // The escalation payload should contain the extracted info
    const payload = JSON.parse(esc.escalation_payload!);
    expect(payload.extractedInfo).toBeTruthy();
    expect(payload.extractedInfo.memberId).toBe('MBR-2024-001');
    expect(payload.validationResult).toMatch(/mismatch|not_found/);

    // Resolve via new workflow
    await resolveEscalation(esc.id, {
      documentId: 'DOC-001',
      memberId: 'MBR-2024-001',
      verified: true,
      note: 'Member moved — address updated in system',
    });

    await sleepFor(10_000);

    // Verify escalation was resolved
    const resolvedEsc = await escalationService.getEscalation(esc.id);
    expect(resolvedEsc!.status).toBe('resolved');
  }, 90_000);

  // ── Vision: escalation payload contains full context for human review ─────

  it('should provide the human reviewer with extracted data and database record', async () => {
    if (!hasOpenAIKey) return;

    const workflowId = `test-vision-context-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: { documentId: 'DOC-002' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'verifyDocument',
      workflowId,
      expire: 120,
    });

    // Poll until the escalation appears (vision API timing varies)
    const escalations = await waitForEscalation(workflowId);
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

    // Clean up — resolve via new workflow
    await resolveEscalation(escalations[0].id, {
      documentId: 'DOC-002',
      verified: true,
    });
    await sleepFor(10_000);
  }, 90_000);

  // ── Vision: multi-page extraction merges data ─────────────────────────────

  it('should merge multi-page extractions into a single record', async () => {
    if (!hasOpenAIKey) return;

    const workflowId = `test-vision-merge-${Durable.guid()}`;

    await client.workflow.start({
      args: [{
        data: { documentId: 'DOC-003' },
        metadata: {},
      }],
      taskQueue: TASK_QUEUE,
      workflowName: 'verifyDocument',
      workflowId,
      expire: 120,
    });

    // Poll until the escalation appears (vision API timing varies)
    const escalations = await waitForEscalation(workflowId);
    const payload = JSON.parse(escalations[0].escalation_payload!);

    // Page 1 should provide: memberId, name, address
    expect(payload.extractedInfo.memberId).toBe('MBR-2024-001');
    expect(payload.extractedInfo.name).toBeTruthy();

    // Page 2 should provide: emergency contact (merged into the record)
    expect(payload.extractedInfo.emergencyContact).toBeTruthy();

    // Clean up — resolve via new workflow
    await resolveEscalation(escalations[0].id, {
      documentId: 'DOC-003',
      verified: true,
    });
    await sleepFor(10_000);
  }, 90_000);

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
