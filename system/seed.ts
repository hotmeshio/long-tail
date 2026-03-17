import { getPool } from '../services/db';
import { loggerRegistry } from '../services/logger';
import { SEED_MCP_SERVER } from '../services/mcp/sql';

// ── Tool manifests ───────────────────────────────────────────────────────────
// Copied from built-in MCP server definitions.

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
    description: 'Rotate a document page image by the given degrees. Deletes the original by default and returns the new image reference. Use the exact rotated_ref in correctedData.',
    inputSchema: {
      type: 'object',
      properties: {
        image_ref: { type: 'string', description: 'Storage reference to the image to rotate' },
        degrees: { type: 'integer', description: 'Rotation degrees (90, 180, 270)' },
        replace_original: { type: 'boolean', description: 'Delete the original file after rotation (default: true)' },
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
  { name: 'find_tasks', description: 'Search tasks with optional filters. Returns task records with workflow_id, status, workflow_type, milestones, created/completed timestamps, and metadata.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, workflow_type: { type: 'string' }, workflow_id: { type: 'string' }, origin_id: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'find_escalations', description: 'Search escalations with optional filters. Returns escalation records with type, role, priority, status, description, and assignment info.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, role: { type: 'string' }, type: { type: 'string' }, priority: { type: 'integer' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_process_summary', description: 'List business processes grouped by origin_id. Each process shows task count, completed/escalated counts, workflow types involved, and time range.', inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_escalation_stats', description: 'Real-time escalation statistics: pending/claimed counts, created/resolved in last 1h and 24h, breakdown by role.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_workflow_types', description: 'List all registered workflow configurations with task queue, roles, invocable flag, and description.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_system_health', description: 'Overall system health snapshot: task counts by status, escalation counts by status, active workflow types, and recent activity window.', inputSchema: { type: 'object', properties: {} } },
];

const MCP_WORKFLOW_TOOLS = [
  {
    name: 'list_workflows',
    description: 'List available compiled YAML workflows. These are deterministic pipelines converted from successful MCP triage executions. Each workflow represents a proven solution to a specific edge case. Defaults to listing active (invocable) workflows.',
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
    description: 'Run a compiled YAML workflow by name. Deterministic — no LLM reasoning, just direct tool-to-tool data piping. Use list_workflows to discover available workflows and their input schemas. Set async=true for fire-and-forget.',
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
    description: 'Analyze a completed workflow execution and convert its tool call sequence into a deterministic HotMesh YAML workflow. Extracts tool call pairs and replaces LLM reasoning with direct tool-to-tool data piping. The generated YAML is stored as a draft that can be deployed and activated.',
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
    description: 'Deploy a stored YAML workflow to HotMesh. Optionally activate it immediately and register workers so it can receive invocations.',
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

const PLAYWRIGHT_TOOLS = [
  { name: 'navigate', description: 'Open a URL in a browser page. Returns a page_id handle for subsequent tool calls.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, wait_until: { type: 'string', description: 'load | domcontentloaded | networkidle' } }, required: ['url'] } },
  { name: 'screenshot', description: 'Capture a screenshot and save as PNG. Pass url for a self-contained navigate+screenshot, or page_id to screenshot an existing page.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, wait_until: { type: 'string' }, path: { type: 'string' }, page_id: { type: 'string' }, full_page: { type: 'boolean' }, selector: { type: 'string' } }, required: ['path'] } },
  { name: 'click', description: 'Click an element by CSS selector. Waits 500ms after click for SPA transitions.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, page_id: { type: 'string' } }, required: ['selector'] } },
  { name: 'fill', description: 'Type a value into an input field by CSS selector.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' }, page_id: { type: 'string' } }, required: ['selector', 'value'] } },
  { name: 'wait_for', description: 'Wait for a CSS selector to appear on the page. For URL-based waiting, use run_script with wait_for_url action instead.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, page_id: { type: 'string' }, timeout: { type: 'number' } }, required: ['selector'] } },
  { name: 'evaluate', description: 'Evaluate JavaScript in the page context. Returns the expression result.', inputSchema: { type: 'object', properties: { script: { type: 'string' }, page_id: { type: 'string' } }, required: ['script'] } },
  {
    name: 'run_script',
    description: 'Execute a multi-step browser script in a single call. All steps share one page. Actions: navigate (go to URL), screenshot (save PNG), click (CSS selector), fill (input value), wait_for (CSS selector appears), wait_for_url (URL matches/not-matches pattern), wait (fixed delay in ms), evaluate (run JS). Use wait_for_url with not=true after login clicks to wait for SPA navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Ordered list of browser actions to execute sequentially on a single page',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['navigate', 'screenshot', 'click', 'fill', 'wait_for', 'wait_for_url', 'wait', 'evaluate'] },
              url: { type: 'string', description: 'URL for navigate, or URL pattern for wait_for_url' },
              wait_until: { type: 'string' },
              path: { type: 'string' },
              full_page: { type: 'boolean' },
              selector: { type: 'string' },
              value: { type: 'string' },
              script: { type: 'string' },
              timeout: { type: 'number', description: 'Timeout in ms for wait_for/wait_for_url, or delay for wait' },
              not: { type: 'boolean', description: 'For wait_for_url: wait until URL does NOT match (default: false)' },
            },
            required: ['action'],
          },
        },
      },
      required: ['steps'],
    },
  },
  { name: 'list_pages', description: 'List all open browser pages.', inputSchema: { type: 'object', properties: {} } },
  { name: 'close_page', description: 'Close a browser page by ID.', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
];

const FILE_STORAGE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read file content from managed storage. Returns content, size, and detected MIME type. Supports utf8 (text) or base64 encoding.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file in managed storage' },
        encoding: { type: 'string', description: 'Encoding to use (utf8 or base64)', default: 'utf8' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in managed storage. Creates directories as needed. Returns the storage reference and size.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path for the file in managed storage' },
        content: { type: 'string', description: 'File content to write' },
        encoding: { type: 'string', description: 'Encoding of the content (utf8 or base64)', default: 'utf8' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a storage directory. Returns file paths, sizes, and modification timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory path to list (default: root)', default: '/' },
        recursive: { type: 'boolean', description: 'Whether to list recursively', default: false },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Remove a file from managed storage.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file to delete' },
      },
      required: ['path'],
    },
  },
];

const HTTP_FETCH_TOOLS = [
  {
    name: 'http_request',
    description: 'Make an HTTP request to any URL. Supports all methods, custom headers, and request bodies. Returns status, headers, and body.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to request' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body' },
        timeout_ms: { type: 'number', description: 'Request timeout in milliseconds' },
      },
      required: ['url'],
    },
  },
  {
    name: 'fetch_json',
    description: 'GET a URL and parse the response as JSON. Convenience wrapper around http_request.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch JSON from' },
        headers: { type: 'object', description: 'Request headers' },
      },
      required: ['url'],
    },
  },
  {
    name: 'fetch_text',
    description: 'GET a URL and return the response as text. Returns content, status, and content type.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch text from' },
        headers: { type: 'object', description: 'Request headers' },
      },
      required: ['url'],
    },
  },
];

// ── Seed MCP servers ─────────────────────────────────────────────────────────
//
// Register the built-in MCP servers so the dashboard shows them immediately.
// These are in-process servers (no external transport) — the tool manifests
// are pre-populated from the actual server definitions.

const SEED_MCP_SERVERS = [
  {
    name: 'long-tail-db-query',
    description: 'Read-only query tools for tasks, escalations, processes, and system health. Used by triage workflows to gather context before making decisions.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: DB_QUERY_TOOLS,
    metadata: { builtin: true, category: 'database' },
    tags: ['database', 'query', 'analytics'],
  },
  {
    name: 'long-tail-human-queue',
    description: 'Built-in escalation and human queue management. Exposes the escalation API as MCP tools for AI agents and remediation workflows.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: HUMAN_QUEUE_TOOLS,
    metadata: { builtin: true, category: 'escalation' },
    tags: ['escalation', 'human-queue', 'routing'],
  },
  {
    name: 'mcp-workflows-longtail',
    description: 'Compiled YAML workflows — hardened deterministic pipelines from successful MCP triage executions. Invoke proven solutions to edge cases without LLM reasoning.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: MCP_WORKFLOW_TOOLS,
    metadata: { builtin: true, category: 'workflows' },
    tags: ['workflows', 'compiled', 'deterministic'],
  },
  {
    name: 'long-tail-workflow-compiler',
    description: 'Convert dynamic MCP tool call sequences into deterministic YAML workflows. Analyze executions, generate pipelines, deploy and activate.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: WORKFLOW_COMPILER_TOOLS,
    metadata: { builtin: true, category: 'compilation' },
    tags: ['compilation', 'yaml', 'codegen'],
  },
  {
    name: 'long-tail-document-vision',
    description: 'Document vision and analysis tools. Processes document images, extracts structured data, validates against databases, and handles translations.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: VISION_TOOLS,
    metadata: { builtin: true, category: 'document-processing' },
    tags: ['document-processing', 'vision', 'ocr', 'translation'],
  },
  {
    name: 'long-tail-playwright',
    description: 'Browser automation via Playwright. Navigate pages, take screenshots, click elements, fill forms, run JavaScript. Used for QA capture, visual regression, and documentation.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: PLAYWRIGHT_TOOLS,
    metadata: { builtin: true, category: 'browser-automation' },
    tags: ['browser-automation', 'testing', 'screenshots'],
  },
  {
    name: 'long-tail-file-storage',
    description: 'Managed file storage for reading, writing, listing, and deleting files. Used by workflows and triage agents for persistent file I/O.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: FILE_STORAGE_TOOLS,
    metadata: { builtin: true, category: 'storage' },
    tags: ['storage', 'files', 'io'],
  },
  {
    name: 'long-tail-http-fetch',
    description: 'HTTP client tools for making GET, POST, and arbitrary HTTP requests. Used by triage agents and workflows to call external APIs and fetch remote resources.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: HTTP_FETCH_TOOLS,
    metadata: { builtin: true, category: 'http' },
    tags: ['http', 'api', 'fetch', 'network'],
  },
];

/**
 * Seed system MCP servers into lt_mcp_servers.
 * Upserts each built-in server with its tool manifest, metadata, and tags.
 */
export async function seedSystemMcpServers(): Promise<void> {
  const pool = getPool();
  for (const srv of SEED_MCP_SERVERS) {
    try {
      await pool.query(
        SEED_MCP_SERVER,
        [
          srv.name,
          srv.description,
          srv.transport_type,
          JSON.stringify(srv.transport_config),
          JSON.stringify(srv.tool_manifest),
          JSON.stringify(srv.metadata),
          srv.tags,
        ],
      );
    } catch (err: any) {
      loggerRegistry.warn(`[system] failed to seed MCP server ${srv.name}: ${err.message}`);
    }
  }
  const totalTools = SEED_MCP_SERVERS.reduce((sum, s) => sum + s.tool_manifest.length, 0);
  loggerRegistry.info(`[system] MCP servers seeded (${SEED_MCP_SERVERS.length} servers, ${totalTools} tools)`);
}
