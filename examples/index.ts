import { Durable } from '@hotmeshio/hotmesh';

import * as reviewContentWorkflow from './workflows/review-content';
import * as verifyDocumentWorkflow from './workflows/verify-document';
import * as verifyDocumentMcpWorkflow from './workflows/verify-document-mcp';
import * as reviewContentOrchWorkflow from './workflows/review-content/orchestrator';
import * as verifyDocumentOrchWorkflow from './workflows/verify-document/orchestrator';
import * as verifyDocumentMcpOrchWorkflow from './workflows/verify-document-mcp/orchestrator';
import * as mcpTriageWorkflow from './workflows/mcp-triage';
import * as mcpTriageOrchWorkflow from './workflows/mcp-triage/orchestrator';

import type { LTEnvelope } from '../types';
import type {
  ReviewContentEnvelopeData,
  VerifyDocumentEnvelopeData,
  InvocableWorkflowType,
} from './types';
import { loggerRegistry } from '../services/logger';
import { getUserByExternalId, createUser } from '../services/user';

/**
 * Example workers that ship with Long Tail.
 * Pass these to `start({ workers: [...exampleWorkers] })` or enable
 * via `examples: true` in the start config.
 */
export const exampleWorkers = [
  { taskQueue: 'long-tail', workflow: reviewContentWorkflow.reviewContent },
  { taskQueue: 'long-tail-verify', workflow: verifyDocumentWorkflow.verifyDocument },
  { taskQueue: 'long-tail-verify-mcp', workflow: verifyDocumentMcpWorkflow.verifyDocumentMcp },
  { taskQueue: 'lt-review-orch', workflow: reviewContentOrchWorkflow.reviewContentOrchestrator },
  { taskQueue: 'lt-verify-orch', workflow: verifyDocumentOrchWorkflow.verifyDocumentOrchestrator },
  { taskQueue: 'lt-verify-mcp-orch', workflow: verifyDocumentMcpOrchWorkflow.verifyDocumentMcpOrchestrator },
  { taskQueue: 'lt-mcp-triage', workflow: mcpTriageWorkflow.mcpTriage },
  { taskQueue: 'lt-mcp-triage-orch', workflow: mcpTriageOrchWorkflow.mcpTriageOrchestrator },
];

const SEED_USERS = [
  {
    external_id: 'superadmin',
    display_name: 'Super Admin',
    email: 'admin@longtail.local',
    password: 'superadmin123',
    roles: [{ role: 'superadmin', type: 'superadmin' as const }],
  },
  {
    external_id: 'admin',
    display_name: 'Admin User',
    email: 'admin-user@longtail.local',
    password: 'admin123',
    roles: [{ role: 'admin', type: 'admin' as const }],
  },
  {
    external_id: 'engineer',
    display_name: 'Engineer User',
    email: 'engineer@longtail.local',
    password: 'engineer123',
    roles: [{ role: 'engineer', type: 'member' as const }],
  },
  {
    external_id: 'reviewer',
    display_name: 'Reviewer User',
    email: 'reviewer@longtail.local',
    password: 'reviewer123',
    roles: [{ role: 'reviewer', type: 'member' as const }],
  },
];

async function seedUsers(): Promise<void> {
  for (const userDef of SEED_USERS) {
    try {
      const existing = await getUserByExternalId(userDef.external_id);
      if (existing) {
        loggerRegistry.info(`[examples] ${userDef.external_id} already exists, skipping`);
        continue;
      }
      await createUser(userDef);
      loggerRegistry.info(`[examples] seeded user (${userDef.external_id} / ${userDef.password})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to seed ${userDef.external_id}: ${err.message}`);
    }
  }
}

/**
 * Seed a handful of example workflows so the dashboard has data immediately.
 * Called automatically when `examples: true` is set in the start config.
 */
export async function seedExamples(client: any): Promise<void> {
  await seedUsers();
  const envelopes: Array<{
    workflowName: InvocableWorkflowType;
    taskQueue: string;
    envelope: LTEnvelope;
  }> = [
    {
      workflowName: 'reviewContentOrchestrator',
      taskQueue: 'lt-review-orch',
      envelope: {
        data: {
          contentId: 'seed-article-001',
          content: 'This is a well-written article about renewable energy solutions for urban environments. It covers solar panels, wind turbines, and energy storage technologies with thorough citations.',
          contentType: 'article',
        } satisfies ReviewContentEnvelopeData,
        metadata: { source: 'seed', seededAt: new Date().toISOString() },
      },
    },
    {
      workflowName: 'reviewContentOrchestrator',
      taskQueue: 'lt-review-orch',
      envelope: {
        data: {
          contentId: 'seed-article-002',
          content: 'Buy now! Limited time offer! Click here for amazing deals!!!',
          contentType: 'advertisement',
        } satisfies ReviewContentEnvelopeData,
        metadata: { source: 'seed', seededAt: new Date().toISOString() },
      },
    },
    {
      workflowName: 'verifyDocumentOrchestrator',
      taskQueue: 'lt-verify-orch',
      envelope: {
        data: {
          documentId: 'seed-doc-001',
          documentUrl: 'https://example.com/documents/drivers-license-sample.jpg',
          documentType: 'drivers_license',
          memberId: 'member-12345',
        } satisfies VerifyDocumentEnvelopeData,
        metadata: { source: 'seed', seededAt: new Date().toISOString() },
      },
    },
  ];

  for (const { workflowName, taskQueue, envelope } of envelopes) {
    try {
      const workflowId = `${workflowName}-seed-${Durable.guid().slice(0, 8)}`;
      await client.workflow.start({
        args: [envelope],
        taskQueue,
        workflowName,
        workflowId,
        expire: 86_400,
        entity: workflowName,
      } as any);
      loggerRegistry.info(`[examples] seeded workflow: ${workflowId}`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] seed failed for ${workflowName}: ${err.message}`);
    }
  }
}
