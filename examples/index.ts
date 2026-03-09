import { Durable } from '@hotmeshio/hotmesh';

import * as reviewContentWorkflow from './workflows/review-content';
import * as verifyDocumentWorkflow from './workflows/verify-document';
import * as verifyDocumentMcpWorkflow from './workflows/verify-document-mcp';
import * as reviewContentOrchWorkflow from './workflows/review-content/orchestrator';
import * as verifyDocumentOrchWorkflow from './workflows/verify-document/orchestrator';
import * as verifyDocumentMcpOrchWorkflow from './workflows/verify-document-mcp/orchestrator';
import * as processClaimWorkflow from './workflows/process-claim';
import * as processClaimOrchWorkflow from './workflows/process-claim/orchestrator';
import * as mcpTriageWorkflow from './workflows/mcp-triage';
import * as mcpTriageOrchWorkflow from './workflows/mcp-triage/orchestrator';
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
  { taskQueue: 'lt-process-claim', workflow: processClaimWorkflow.processClaim },
  { taskQueue: 'lt-process-claim-orch', workflow: processClaimOrchWorkflow.processClaimOrchestrator },
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
//   The triage controller detects simple approval intent via pre-flight
//   pattern matching and passes through without LLM calls (fastest path).
//   Or, with a complex message: "Check system health before approving",
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
    taskQueue: 'lt-review-orch',
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
    taskQueue: 'lt-review-orch',
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
    taskQueue: 'lt-review-orch',
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
    taskQueue: 'lt-process-claim-orch',
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
    taskQueue: 'lt-kitchen-sink-orch',
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

const DB_QUERY_TOOLS = [
  { name: 'find_tasks', description: 'Search tasks by status, workflow type, or origin.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, workflow_type: { type: 'string' }, workflow_id: { type: 'string' }, origin_id: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'find_escalations', description: 'Search escalations by status, role, type, or priority.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, role: { type: 'string' }, type: { type: 'string' }, priority: { type: 'integer' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_process_summary', description: 'Aggregate process view grouped by origin_id.', inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_escalation_stats', description: 'Real-time escalation statistics.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_workflow_types', description: 'List registered workflow configurations.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_system_health', description: 'Overall system health snapshot.', inputSchema: { type: 'object', properties: {} } },
];

const TELEMETRY_TOOLS = [
  {
    name: 'query_trace',
    description: 'Look up all spans for a specific OpenTelemetry trace ID in Honeycomb. Returns span details including name, service, duration, status, and parent-child relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        trace_id: { type: 'string', description: 'The OpenTelemetry trace ID to look up' },
        dataset: { type: 'string', description: 'Honeycomb dataset (defaults to "long-tail")' },
      },
      required: ['trace_id'],
    },
  },
  {
    name: 'find_recent_traces',
    description: 'Search for recent traces in Honeycomb. Returns trace IDs with summary info including root span name, total duration, and span count.',
    inputSchema: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'Filter by service name' },
        duration_ms_gt: { type: 'number', description: 'Only traces longer than this duration (ms)' },
        time_range_minutes: { type: 'integer', description: 'How far back to search (minutes, max 1440)', default: 60 },
        limit: { type: 'integer', description: 'Maximum number of traces to return', default: 20 },
      },
    },
  },
  {
    name: 'get_trace_timeline',
    description: 'Get an ordered timeline view of a trace, showing the workflow execution DAG with parent-child relationships and durations.',
    inputSchema: {
      type: 'object',
      properties: {
        trace_id: { type: 'string', description: 'The OpenTelemetry trace ID' },
        dataset: { type: 'string', description: 'Honeycomb dataset (defaults to "long-tail")' },
      },
      required: ['trace_id'],
    },
  },
];

const MCP_WORKFLOW_TOOLS = [
  {
    name: 'list_workflows',
    description: 'Discover available compiled YAML workflows. These are deterministic pipelines converted from successful MCP triage executions.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by lifecycle status (default: "active")' },
      },
    },
  },
  {
    name: 'get_workflow',
    description: 'Inspect a compiled workflow by name. Returns the activity manifest, input/output schemas, and provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_name: { type: 'string', description: 'Name of the workflow to inspect' },
      },
      required: ['workflow_name'],
    },
  },
  {
    name: 'invoke_workflow',
    description: 'Run a compiled YAML workflow by name. No LLM reasoning — direct tool-to-tool data piping.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_name: { type: 'string', description: 'Name of the compiled workflow to invoke' },
        input: { type: 'object', description: 'Input data matching the workflow input schema' },
        async: { type: 'boolean', description: 'If true, fire-and-forget (returns job ID)' },
        timeout: { type: 'number', description: 'Max ms to wait for result (sync mode only)' },
      },
      required: ['workflow_name'],
    },
  },
];

const WORKFLOW_COMPILER_TOOLS = [
  {
    name: 'convert_execution_to_yaml',
    description: 'Analyze a completed workflow execution and convert its tool call sequence into a deterministic HotMesh YAML workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'The workflow execution ID to analyze' },
        task_queue: { type: 'string', description: 'HotMesh task queue' },
        workflow_name: { type: 'string', description: 'Workflow name' },
        yaml_name: { type: 'string', description: 'Name for the generated YAML workflow' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['workflow_id', 'task_queue', 'workflow_name', 'yaml_name'],
    },
  },
  {
    name: 'deploy_yaml_workflow',
    description: 'Deploy a stored YAML workflow to HotMesh. Optionally activate immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        yaml_workflow_id: { type: 'string', description: 'UUID of the stored YAML workflow' },
        activate: { type: 'boolean', description: 'Whether to activate immediately after deployment' },
      },
      required: ['yaml_workflow_id'],
    },
  },
  {
    name: 'list_yaml_workflows',
    description: 'List stored YAML workflows with optional status filter.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status (draft, deployed, active, archived)' },
        limit: { type: 'integer', description: 'Maximum results (default: 25)' },
        offset: { type: 'integer', description: 'Pagination offset' },
      },
    },
  },
];

const SEED_MCP_SERVERS = [
  {
    name: 'long-tail-db-query',
    description: 'Read-only query tools for tasks, escalations, processes, and system health. Used by triage workflows to gather context before making decisions.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: DB_QUERY_TOOLS,
    metadata: { builtin: true, category: 'database' },
  },
  {
    name: 'long-tail-human-queue',
    description: 'Built-in escalation and human queue management. Exposes the escalation API as MCP tools for AI agents and remediation workflows.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: HUMAN_QUEUE_TOOLS,
    metadata: { builtin: true, category: 'escalation' },
  },
  {
    name: 'mcp-workflows-longtail',
    description: 'Compiled YAML workflows — hardened deterministic pipelines from successful MCP triage executions. Invoke proven solutions to edge cases without LLM reasoning.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: MCP_WORKFLOW_TOOLS,
    metadata: { builtin: true, category: 'workflows' },
  },
  {
    name: 'long-tail-workflow-compiler',
    description: 'Convert dynamic MCP tool call sequences into deterministic YAML workflows. Analyze executions, generate pipelines, deploy and activate.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: WORKFLOW_COMPILER_TOOLS,
    metadata: { builtin: true, category: 'compilation' },
  },
  {
    name: 'long-tail-document-vision',
    description: 'Document vision and analysis tools. Processes document images, extracts structured data, validates against databases, and handles translations.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: VISION_TOOLS,
    metadata: { builtin: true, category: 'document-processing' },
  },
  {
    name: 'long-tail-telemetry',
    description: 'Honeycomb telemetry query tools. Traces workflow executions, identifies bottlenecks, and correlates errors across the distributed DAG.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: TELEMETRY_TOOLS,
    metadata: { builtin: true, category: 'telemetry' },
  },
  {
    name: 'long-tail-playwright',
    description: 'Browser automation via Playwright. Navigate pages, take screenshots, click elements, fill forms, run JavaScript. Used for QA capture, visual regression, and documentation.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: [
      { name: 'navigate', description: 'Open a URL in a new browser page.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, wait_until: { type: 'string' } }, required: ['url'] } },
      { name: 'screenshot', description: 'Capture a screenshot and save as PNG.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, page_id: { type: 'string' }, full_page: { type: 'boolean' }, selector: { type: 'string' } }, required: ['path'] } },
      { name: 'click', description: 'Click an element by CSS selector.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, page_id: { type: 'string' } }, required: ['selector'] } },
      { name: 'fill', description: 'Type a value into an input field.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' }, page_id: { type: 'string' } }, required: ['selector', 'value'] } },
      { name: 'wait_for', description: 'Wait for an element to appear on the page.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, page_id: { type: 'string' }, timeout: { type: 'number' } }, required: ['selector'] } },
      { name: 'evaluate', description: 'Evaluate JavaScript in the page context.', inputSchema: { type: 'object', properties: { script: { type: 'string' }, page_id: { type: 'string' } }, required: ['script'] } },
      { name: 'list_pages', description: 'List all open browser pages.', inputSchema: { type: 'object', properties: {} } },
      { name: 'close_page', description: 'Close a browser page by ID.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
    ],
    metadata: { builtin: true, category: 'browser-automation' },
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
           metadata = EXCLUDED.metadata,
           description = EXCLUDED.description,
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
  const totalTools = SEED_MCP_SERVERS.reduce((sum, s) => sum + s.tool_manifest.length, 0);
  loggerRegistry.info(`[examples] MCP servers seeded (${SEED_MCP_SERVERS.length} servers, ${totalTools} tools)`);
}

/**
 * Seed example workflows so the dashboard tells a story immediately.
 * Called automatically when `examples: true` is set in the start config.
 */
export async function seedExamples(client: any): Promise<void> {
  await seedRoles();
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
