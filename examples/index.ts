import { Durable } from '@hotmeshio/hotmesh';

import * as reviewContentWorkflow from './workflows/review-content';
import * as verifyDocumentWorkflow from './workflows/verify-document';
import * as verifyDocumentMcpWorkflow from './workflows/verify-document-mcp';
import * as reviewContentOrchWorkflow from './workflows/review-content/orchestrator';
import * as verifyDocumentOrchWorkflow from './workflows/verify-document/orchestrator';
import * as verifyDocumentMcpOrchWorkflow from './workflows/verify-document-mcp/orchestrator';
import * as processClaimWorkflow from './workflows/process-claim';
import * as processClaimOrchWorkflow from './workflows/process-claim/orchestrator';
import * as kitchenSinkWorkflow from './workflows/kitchen-sink';
import * as kitchenSinkOrchWorkflow from './workflows/kitchen-sink/orchestrator';

import type { LTEnvelope } from '../types';
import type {
  ReviewContentEnvelopeData,
  ProcessClaimEnvelopeData,
  KitchenSinkEnvelopeData,
  InvocableWorkflowType,
} from './types';
import { loggerRegistry } from '../services/logger';
import { getUserByExternalId, createUser } from '../services/user';
import { addEscalationChain, createRole } from '../services/role';

/**
 * Example workers that ship with Long Tail.
 * Pass these to `start({ workers: [...exampleWorkers] })` or enable
 * via `examples: true` in the start config.
 */
export const exampleWorkers = [
  { taskQueue: 'long-tail-examples', workflow: reviewContentWorkflow.reviewContent },
  { taskQueue: 'long-tail-examples', workflow: verifyDocumentWorkflow.verifyDocument },
  { taskQueue: 'long-tail-examples', workflow: verifyDocumentMcpWorkflow.verifyDocumentMcp },
  { taskQueue: 'long-tail-examples', workflow: reviewContentOrchWorkflow.reviewContentOrchestrator },
  { taskQueue: 'long-tail-examples', workflow: verifyDocumentOrchWorkflow.verifyDocumentOrchestrator },
  { taskQueue: 'long-tail-examples', workflow: verifyDocumentMcpOrchWorkflow.verifyDocumentMcpOrchestrator },
  { taskQueue: 'long-tail-examples', workflow: processClaimWorkflow.processClaim },
  { taskQueue: 'long-tail-examples', workflow: processClaimOrchWorkflow.processClaimOrchestrator },
  { taskQueue: 'long-tail-examples', workflow: kitchenSinkWorkflow.kitchenSink },
  { taskQueue: 'long-tail-examples', workflow: kitchenSinkOrchWorkflow.kitchenSinkOrchestrator },
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

const SEED_ROLES = ['reviewer', 'engineer', 'admin', 'superadmin'];

async function seedRoles(): Promise<void> {
  for (const role of SEED_ROLES) {
    try {
      await createRole(role);
    } catch { /* ON CONFLICT DO NOTHING handles duplicates */ }
  }
  loggerRegistry.info(`[examples] roles verified (${SEED_ROLES.join(', ')})`);
}

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

// ── Seed processes ───────────────────────────────────────────────────────────
//
// Four deterministic processes that tell the LongTail story:
//
// Process 1 — "Clean Review"
//   Content passes AI analysis. Auto-approved. The happy path.
//
// Process 2 — "Flagged for Review"
//   Content triggers REVIEW_ME flag. AI escalates to reviewer role.
//   Instruction: Log in as `reviewer` and approve the content.
//
// Process 3 — "Wrong Language → Durable MCP"
//   Content arrives in Spanish with WRONG_LANGUAGE marker.
//   AI flags it with low confidence (0.15) → escalates to reviewer.
//   Instruction chain:
//     reviewer  → escalate to admin (language issue, outside your role)
//     admin     → escalate to engineer (needs technical fix)
//     engineer  → check "Request AI Triage", describe: "Content is in Spanish, needs translation"
//   The MCP triage orchestrator uses LLM + Vision tools to diagnose the
//   issue, translate the content, re-run the workflow (auto-approves),
//   and creates an engineering escalation recommending a language
//   detection step in the pipeline.
//
// Process 4 — "Damaged Claim → MCP Triage (Image Orientation)"
//   Insurance claim arrives with upside-down document images.
//   AI analysis returns low confidence (0.35) → escalates to reviewer.
//   Instruction:
//     reviewer → check "Request AI Triage", describe: "Document images
//       appear damaged or upside down, unable to read claim data"
//   The MCP triage orchestrator uses LLM + Vision tools to diagnose,
//   rotate images, verify extraction, re-run the claim workflow, and
//   it auto-approves with corrected docs.
//
// Process 5 — "Dynamic Triage (Kitchen Sink)"
//   Kitchen-sink workflow creates a standard escalation (reviewer approval).
//   Demonstrates the GENERIC triage controller with a non-domain-specific
//   workflow:
//     reviewer → check "Request AI Triage", write: "This looks fine, approve"
//   The triage controller sends the message to the LLM, which recognizes
//   simple approval intent and returns correctedData without tool calls.
//   With a complex message like "Check system health before approving",
//   the LLM uses DB query tools (find_tasks, get_system_health) to
//   investigate, then decides whether to approve.

const SEED_ENVELOPES: Array<{
  workflowName: InvocableWorkflowType;
  taskQueue: string;
  envelope: LTEnvelope;
  label: string;
}> = [
  // ── Process 1: Clean Review ─────────────────────────────────────
  {
    label: 'Process 1 — Clean Review',
    workflowName: 'reviewContentOrchestrator',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        contentId: 'process-clean-001',
        content: 'This is a well-researched article about renewable energy solutions for urban environments. It covers solar panels, wind turbines, and energy storage with thorough citations and balanced analysis.',
        contentType: 'article',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'clean-review',
        description: 'Happy path — AI auto-approves high-quality content',
      },
    },
  },

  // ── Process 2: Flagged for Review ───────────────────────────────
  {
    label: 'Process 2 — Flagged for Review',
    workflowName: 'reviewContentOrchestrator',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        contentId: 'process-flagged-001',
        content: 'REVIEW_ME This user-submitted blog post discusses alternative medicine claims without citing peer-reviewed sources. The AI flagged it for human review.',
        contentType: 'blog_post',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'flagged-review',
        description: 'AI flags content for human review. Log in as reviewer (reviewer/reviewer123) and approve or reject.',
      },
    },
  },

  // ── Process 3: Wrong Language → Durable MCP ────────────────────
  {
    label: 'Process 3 — Wrong Language',
    workflowName: 'reviewContentOrchestrator',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        contentId: 'process-language-001',
        content: 'WRONG_LANGUAGE La energía renovable es el futuro de las ciudades sostenibles. Los paneles solares y las turbinas eólicas pueden reducir significativamente la huella de carbono urbana cuando se combinan con sistemas modernos de almacenamiento de energía.',
        contentType: 'article',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'wrong-language',
        description: 'Content arrived in the wrong language. Walk the escalation chain: reviewer → admin → engineer. As engineer, check "Request AI Triage" and describe: "Content is in Spanish, needs translation to English." The MCP triage orchestrator uses AI + Vision tools to diagnose, translate the content, re-run the workflow, and recommend adding language detection to the pipeline.',
      },
    },
  },

  // ── Process 4: Damaged Claim → MCP Triage ────────────────────
  {
    label: 'Process 4 — Damaged Claim',
    workflowName: 'processClaimOrchestrator',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        claimId: 'CLM-2024-042',
        claimantId: 'MBR-2024-001',
        claimType: 'auto_collision',
        amount: 12500,
        documents: [
          'page1_upside_down.png',
          'page2.png',
        ],
      } satisfies ProcessClaimEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'damaged-claim',
        description:
          'Insurance claim with an upside-down member application scan. ' +
          'AI Vision detects the orientation issue and flags low confidence. ' +
          'As reviewer, check "Request AI Triage" and describe the problem: ' +
          '"Page 1 appears to be scanned upside down. Cannot read member ID or address." ' +
          'The MCP triage orchestrator uses AI + Vision tools to diagnose the issue, ' +
          'rotate the page with sharp, re-extract member info, validate against the DB, ' +
          're-run the claim workflow with corrected documents, and it auto-approves.',
      },
    },
  },

  // ── Process 5: Kitchen Sink → Dynamic Triage ────────────────
  {
    label: 'Process 5 — Dynamic Triage',
    workflowName: 'kitchenSinkOrchestrator',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        name: 'Triage Demo',
        mode: 'full',
      } satisfies KitchenSinkEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'dynamic-triage',
        description:
          'Demonstrates the dynamic triage controller with a generic workflow. ' +
          'The kitchen-sink workflow creates an escalation waiting for approval. ' +
          'As reviewer, check "Request AI Triage" and write a natural language ' +
          'message like: "This looks fine, just approve it." The triage controller ' +
          'detects simple approval intent and passes through without LLM calls. ' +
          'Try again with a complex message like: "Something seems wrong — check ' +
          'the system health and recent escalation stats before approving." The ' +
          'triage agent will use database query tools to investigate, then decide.',
      },
    },
  },
];

// Escalation chains required for the Process 3 story:
//   reviewer → admin → engineer (and cross-links for flexibility)
const SEED_CHAINS = [
  ['reviewer', 'admin'],
  ['reviewer', 'engineer'],
  ['admin', 'engineer'],
  ['admin', 'superadmin'],
  ['engineer', 'admin'],
  ['engineer', 'superadmin'],
];

async function seedEscalationChains(): Promise<void> {
  for (const [source, target] of SEED_CHAINS) {
    try {
      await addEscalationChain(source, target);
    } catch { /* ON CONFLICT DO NOTHING handles duplicates */ }
  }
  loggerRegistry.info(`[examples] escalation chains verified (${SEED_CHAINS.length} entries)`);
}

/**
 * Seed example workflows so the dashboard tells a story immediately.
 * Called automatically when `examples: true` is set in the start config.
 */
export async function seedExamples(client: any): Promise<void> {
  await seedRoles();
  await seedUsers();
  await seedEscalationChains();

  for (const { workflowName, taskQueue, envelope, label } of SEED_ENVELOPES) {
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
      loggerRegistry.info(`[examples] seeded: ${label} (${workflowId})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] seed failed for ${label}: ${err.message}`);
    }
  }
}
