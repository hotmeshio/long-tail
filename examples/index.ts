import { Durable } from '@hotmeshio/hotmesh';

import * as reviewContentWorkflow from './workflows/review-content';
import * as verifyDocumentWorkflow from './workflows/verify-document';
import * as verifyDocumentMcpWorkflow from './workflows/verify-document-mcp';
import * as reviewContentOrchWorkflow from './workflows/review-content/orchestrator';
import * as verifyDocumentOrchWorkflow from './workflows/verify-document/orchestrator';
import * as verifyDocumentMcpOrchWorkflow from './workflows/verify-document-mcp/orchestrator';
import * as mcpTriageWorkflow from './workflows/mcp-triage';
import * as mcpTriageOrchWorkflow from './workflows/mcp-triage/orchestrator';
import * as kitchenSinkWorkflow from './workflows/kitchen-sink';
import * as kitchenSinkOrchWorkflow from './workflows/kitchen-sink/orchestrator';

import type { LTEnvelope } from '../types';
import type {
  ReviewContentEnvelopeData,
  InvocableWorkflowType,
} from './types';
import { loggerRegistry } from '../services/logger';
import { getUserByExternalId, createUser } from '../services/user';
import { addEscalationChain } from '../services/role';
import { getPool } from '../services/db';

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
  { taskQueue: 'lt-kitchen-sink', workflow: kitchenSinkWorkflow.kitchenSink },
  { taskQueue: 'lt-kitchen-sink-orch', workflow: kitchenSinkOrchWorkflow.kitchenSinkOrchestrator },
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

// ── Seed journeys ────────────────────────────────────────────────────────────
//
// Three deterministic journeys that tell the LongTail story:
//
// Journey 1 — "Clean Review"
//   Content passes AI analysis. Auto-approved. The happy path.
//
// Journey 2 — "Flagged for Review"
//   Content triggers REVIEW_ME flag. AI escalates to reviewer role.
//   Instruction: Log in as `reviewer` and approve the content.
//
// Journey 3 — "Wrong Language → Durable MCP"
//   Content arrives in Spanish with WRONG_LANGUAGE marker.
//   AI flags it with low confidence (0.15) → escalates to reviewer.
//   Instruction chain:
//     reviewer  → escalate to admin (language issue, outside your role)
//     admin     → escalate to engineer (needs technical fix)
//     engineer  → check "Request AI Triage", hint: wrong_language, submit
//   The MCP triage orchestrator translates the content, re-runs the
//   workflow (auto-approves), and creates an engineering escalation
//   recommending a language detection step in the pipeline.

const SEED_ENVELOPES: Array<{
  workflowName: InvocableWorkflowType;
  taskQueue: string;
  envelope: LTEnvelope;
  label: string;
}> = [
  // ── Journey 1: Clean Review ──────────────────────────────────────
  {
    label: 'Journey 1 — Clean Review',
    workflowName: 'reviewContentOrchestrator',
    taskQueue: 'lt-review-orch',
    envelope: {
      data: {
        contentId: 'journey-clean-001',
        content: 'This is a well-researched article about renewable energy solutions for urban environments. It covers solar panels, wind turbines, and energy storage with thorough citations and balanced analysis.',
        contentType: 'article',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        journey: 'clean-review',
        description: 'Happy path — AI auto-approves high-quality content',
      },
    },
  },

  // ── Journey 2: Flagged for Review ────────────────────────────────
  {
    label: 'Journey 2 — Flagged for Review',
    workflowName: 'reviewContentOrchestrator',
    taskQueue: 'lt-review-orch',
    envelope: {
      data: {
        contentId: 'journey-flagged-001',
        content: 'REVIEW_ME This user-submitted blog post discusses alternative medicine claims without citing peer-reviewed sources. The AI flagged it for human review.',
        contentType: 'blog_post',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        journey: 'flagged-review',
        description: 'AI flags content for human review. Log in as reviewer (reviewer/reviewer123) and approve or reject.',
      },
    },
  },

  // ── Journey 3: Wrong Language → Durable MCP ────────────────────
  {
    label: 'Journey 3 — Wrong Language',
    workflowName: 'reviewContentOrchestrator',
    taskQueue: 'lt-review-orch',
    envelope: {
      data: {
        contentId: 'journey-language-001',
        content: 'WRONG_LANGUAGE La energía renovable es el futuro de las ciudades sostenibles. Los paneles solares y las turbinas eólicas pueden reducir significativamente la huella de carbono urbana cuando se combinan con sistemas modernos de almacenamiento de energía.',
        contentType: 'article',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        journey: 'wrong-language',
        description: 'Content arrived in the wrong language. Walk the escalation chain: reviewer → admin → engineer. As engineer, check "Request AI Triage" with hint "wrong_language". The MCP orchestrator translates the content, re-runs the workflow, and recommends adding language detection to the pipeline.',
      },
    },
  },
];

// Escalation chains required for the Journey 3 story:
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

// ── Seed MCP servers ─────────────────────────────────────────────────────────
//
// Register the built-in MCP servers so the dashboard shows them immediately.
// These are in-process servers (no external transport) — the tool manifests
// are pre-populated from the actual server definitions.

const HUMAN_QUEUE_TOOLS = [
  {
    name: 'escalate_to_human',
    description: 'Create a new escalation for human review. Returns the escalation ID.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Target role for the escalation (e.g., "reviewer")' },
        message: { type: 'string', description: 'Description of what needs human review' },
        data: { type: 'object', description: 'Contextual data for the reviewer' },
        type: { type: 'string', description: 'Escalation type classification', default: 'mcp' },
        subtype: { type: 'string', description: 'Escalation subtype', default: 'tool_call' },
        priority: { type: 'number', description: 'Priority: 1 (highest) to 4 (lowest)', default: 2 },
      },
      required: ['role', 'message'],
    },
  },
  {
    name: 'check_resolution',
    description: 'Check the status of an escalation. Returns status and resolver payload if resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The escalation ID to check' },
      },
      required: ['escalation_id'],
    },
  },
  {
    name: 'get_available_work',
    description: 'List available escalations for a role. Returns pending, unassigned escalations.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role to filter by' },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['role'],
    },
  },
  {
    name: 'claim_and_resolve',
    description: 'Claim an escalation and immediately resolve it with a payload. Atomic operation.',
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The escalation ID to claim and resolve' },
        resolver_id: { type: 'string', description: 'Identifier for who/what is resolving' },
        payload: { type: 'object', description: 'Resolution payload data' },
      },
      required: ['escalation_id', 'resolver_id', 'payload'],
    },
  },
];

const VISION_TOOLS = [
  {
    name: 'list_document_pages',
    description: 'List available document page images from storage. Returns an array of image references.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'extract_member_info',
    description: 'Extract member information from a document page image using AI Vision. Returns structured MemberInfo or null.',
    inputSchema: {
      type: 'object',
      properties: {
        image_ref: { type: 'string', description: 'Storage reference to the document page image' },
        page_number: { type: 'integer', description: '1-based page number' },
      },
      required: ['image_ref', 'page_number'],
    },
  },
  {
    name: 'validate_member',
    description: 'Validate extracted member information against the member database. Returns match, mismatch, or not_found.',
    inputSchema: {
      type: 'object',
      properties: {
        member_info: { type: 'object', description: 'Extracted member information to validate' },
      },
      required: ['member_info'],
    },
  },
  {
    name: 'rotate_page',
    description: 'Rotate a document page image by the given degrees. Returns a new image reference for the rotated version.',
    inputSchema: {
      type: 'object',
      properties: {
        image_ref: { type: 'string', description: 'Storage reference to the image to rotate' },
        degrees: { type: 'integer', description: 'Rotation degrees (90, 180, 270)' },
      },
      required: ['image_ref', 'degrees'],
    },
  },
  {
    name: 'translate_content',
    description: 'Translate content text to the target language. Returns the translated content and detected source language.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content text to translate' },
        target_language: { type: 'string', description: 'Target language code (e.g. "en", "es")' },
      },
      required: ['content', 'target_language'],
    },
  },
];

const SEED_MCP_SERVERS = [
  {
    name: 'long-tail-human-queue',
    description: 'Built-in escalation and human queue management. Exposes the escalation API as MCP tools for AI agents and remediation workflows.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: HUMAN_QUEUE_TOOLS,
    metadata: { builtin: true, category: 'escalation' },
  },
  {
    name: 'long-tail-document-vision',
    description: 'Document vision and analysis tools. Processes document images, extracts structured data, validates against databases, and handles translations.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: VISION_TOOLS,
    metadata: { builtin: true, category: 'document-processing' },
  },
];

async function seedMcpServers(): Promise<void> {
  const pool = getPool();
  for (const srv of SEED_MCP_SERVERS) {
    try {
      await pool.query(
        `INSERT INTO lt_mcp_servers
           (name, description, transport_type, transport_config, auto_connect, status, tool_manifest, metadata, last_connected_at)
         VALUES ($1, $2, $3, $4, true, 'connected', $5, $6, NOW())
         ON CONFLICT (name) DO UPDATE SET
           tool_manifest = EXCLUDED.tool_manifest,
           status = 'connected',
           last_connected_at = NOW()`,
        [
          srv.name,
          srv.description,
          srv.transport_type,
          JSON.stringify(srv.transport_config),
          JSON.stringify(srv.tool_manifest),
          JSON.stringify(srv.metadata),
        ],
      );
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to seed MCP server ${srv.name}: ${err.message}`);
    }
  }
  loggerRegistry.info(`[examples] MCP servers seeded (${SEED_MCP_SERVERS.length} servers, ${HUMAN_QUEUE_TOOLS.length + VISION_TOOLS.length} tools)`);
}

/**
 * Seed example workflows so the dashboard tells a story immediately.
 * Called automatically when `examples: true` is set in the start config.
 */
export async function seedExamples(client: any): Promise<void> {
  await seedUsers();
  await seedEscalationChains();
  await seedMcpServers();

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
