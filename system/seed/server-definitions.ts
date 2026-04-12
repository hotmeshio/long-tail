// ── Seed MCP server definitions ──────────────────────────────────────────────
//
// Register the built-in MCP servers so the dashboard shows them immediately.
// These are in-process servers (no external transport) — the tool manifests
// are pre-populated from the actual server definitions.

import { HUMAN_QUEUE_TOOLS } from './tool-manifests-escalation';
import { TRANSLATION_TOOLS, VISION_ANALYSIS_TOOLS, DB_QUERY_TOOLS, FILE_STORAGE_TOOLS, HTTP_FETCH_TOOLS, DOCS_TOOLS, OAUTH_TOOLS } from './tool-manifests-data';
import { PLAYWRIGHT_TOOLS, PLAYWRIGHT_CLI_TOOLS } from './tool-manifests-browser';
import { MCP_WORKFLOW_TOOLS, WORKFLOW_COMPILER_TOOLS, CLAUDE_CODE_TOOLS } from './tool-manifests-workflows';

export const SEED_MCP_SERVERS = [
  {
    name: 'long-tail-db-query',
    description: 'Read-only query tools for tasks, escalations, processes, and system health. Used by triage workflows to gather context before making decisions.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: DB_QUERY_TOOLS,
    metadata: { builtin: true, category: 'database' },
    tags: ['database', 'query', 'analytics'],
    compile_hints: 'Query tools return structured result sets. When a query result is consumed by a later step, wire the specific output field (e.g., "rows", "tasks") — not the entire result object.',
    credential_providers: [],
  },
  {
    name: 'long-tail-human-queue',
    description: 'Built-in escalation and human queue management. Exposes the escalation API as MCP tools for AI agents and remediation workflows.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: HUMAN_QUEUE_TOOLS,
    metadata: { builtin: true, category: 'escalation' },
    tags: ['escalation', 'human-queue', 'routing'],
    compile_hints: [
      'escalate_and_wait creates a durable pause point.',
      'The step AFTER escalate_and_wait is always a signal step (kind: "signal") that receives the human response.',
      'Fields from the signal step output (e.g., password) must be wired via data_flow edges to ALL downstream steps that need them.',
      'When a downstream tool (e.g., run_script, login_and_capture) needs a credential from the signal, wire the signal step output field to the specific tool argument.',
      'For tools with complex stored arguments (like run_script steps arrays), the credential value should be wired to the specific nested field that needs it — use a data_flow edge from the signal step to the consuming step.',
    ].join(' '),
    credential_providers: [],
  },
  {
    name: 'mcp-workflows-longtail',
    description: 'Compiled YAML workflows — hardened deterministic pipelines from successful MCP triage executions. Invoke proven solutions to edge cases without LLM reasoning.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: MCP_WORKFLOW_TOOLS,
    metadata: { builtin: true, category: 'workflows' },
    tags: ['workflows', 'compiled', 'deterministic'],
    compile_hints: null,
    credential_providers: [],
  },
  {
    name: 'long-tail-workflow-compiler',
    description: 'Convert dynamic MCP tool call sequences into deterministic YAML workflows. Analyze executions, generate pipelines, deploy and activate.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: WORKFLOW_COMPILER_TOOLS,
    metadata: { builtin: true, category: 'compilation' },
    tags: ['compilation', 'yaml', 'codegen'],
    compile_hints: null,
    credential_providers: [],
  },
  {
    name: 'long-tail-translation',
    description: 'Text translation using LLM. Translates content between languages with automatic source language detection.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: TRANSLATION_TOOLS,
    metadata: { builtin: true, category: 'text-processing' },
    tags: ['translation', 'language', 'text-processing'],
    compile_hints: null,
    credential_providers: ['anthropic'],
  },
  {
    name: 'long-tail-vision',
    description: 'Image analysis and description using LLM vision. Analyzes images to extract structured data, text content, and descriptions.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: VISION_ANALYSIS_TOOLS,
    metadata: { builtin: true, category: 'vision' },
    tags: ['vision', 'image-analysis', 'multimodal'],
    compile_hints: 'Vision tools process one image at a time. When iterating over multiple images, each iteration should pass a single image URL or data URI.',
    credential_providers: ['anthropic'],
  },
  {
    name: 'long-tail-playwright',
    description: 'Low-level browser automation via Playwright. Fine-grained control: navigate, click, fill, wait_for, evaluate, run_script. Use for complex interactions requiring precise CSS selector targeting.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: PLAYWRIGHT_TOOLS,
    metadata: { builtin: true, category: 'browser-automation', level: 'low' },
    tags: ['browser-automation', 'testing', 'screenshots'],
    compile_hints: [
      'Session fields (_handle, page_id) MUST be threaded from the step that created them to EVERY subsequent step that operates on the browser.',
      'run_script accepts a `steps` array — this is a fixed implementation detail, never a dynamic input.',
      'When run_script follows a signal hook (human input), dynamic values like passwords must be wired from the hook output into the stored steps array.',
      'The `steps` array should be stored as fixed tool_arguments, but individual values within it (url, username, password) that come from trigger inputs or signal hooks should be wired via data_flow edges to their specific argument keys (e.g., to_field: "password").',
    ].join(' '),
    credential_providers: [],
  },
  {
    name: 'long-tail-playwright-cli',
    description: 'High-level browser automation. Intent-based tools (login_and_capture, capture_page, capture_authenticated_pages, extract_content, submit_form) that handle session management, timing, and error recovery internally. Preferred for most browser tasks — use the low-level playwright server only when fine-grained control is needed.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: PLAYWRIGHT_CLI_TOOLS,
    metadata: { builtin: true, category: 'browser-automation', level: 'high' },
    tags: ['browser-automation', 'screenshots', 'scraping', 'forms'],
    compile_hints: [
      'Session fields (_handle, page_id) MUST be threaded from the producing step to ALL subsequent browser steps.',
      'extract_content returns both `links` (structured array of {text, href}) and `script_result` (raw JS eval output). When building a transform to reshape link data for iteration or for capture_authenticated_pages, ALWAYS use `links` as the source field — `script_result` may be null, a string, or unstructured.',
      'capture_authenticated_pages expects a `login` object and a `pages` array. The `login` object contains nested fields (url, username, password, selectors) — flatten credentials as dynamic trigger inputs but keep the object structure in stored tool_arguments. The `pages` array should flow from a transform edge that reshapes `links` into [{url, screenshot_path, wait_ms, full_page}].',
      'For screenshot_path derivation in transforms, use the `screenshot_dir` trigger input as a dynamic prefix (not hardcoded). Derivation strategy: slugify the href, prepend screenshot_dir + "/", append ".png".',
      'When login_and_capture follows a signal hook (human input), wire the password from the hook output to the `password` argument. Wire `url` and `username` from trigger inputs.',
    ].join(' '),
    credential_providers: [],
  },
  {
    name: 'long-tail-docs',
    description: 'Product documentation search and retrieval. List, search, and read Long Tail documentation covering architecture, workflows, MCP, API reference, IAM, and more.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: DOCS_TOOLS,
    metadata: { builtin: true, category: 'documentation' },
    tags: ['documentation', 'help', 'reference'],
    compile_hints: null,
    credential_providers: [],
  },
  {
    name: 'long-tail-file-storage',
    description: 'Managed file storage for reading, writing, listing, and deleting files. Used by workflows and triage agents for persistent file I/O.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: FILE_STORAGE_TOOLS,
    metadata: { builtin: true, category: 'storage' },
    tags: ['storage', 'files', 'io'],
    compile_hints: null,
    credential_providers: [],
  },
  {
    name: 'long-tail-http-fetch',
    description: 'HTTP client tools for making GET, POST, and arbitrary HTTP requests. Used by triage agents and workflows to call external APIs and fetch remote resources.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: HTTP_FETCH_TOOLS,
    metadata: { builtin: true, category: 'http' },
    tags: ['http', 'api', 'fetch', 'network'],
    compile_hints: 'HTTP response bodies may be large. When wiring output to a later step, prefer specific fields from a parsed JSON response rather than the raw body.',
    credential_providers: [],
  },
  {
    name: 'long-tail-oauth',
    description: 'OAuth token management. Get fresh access tokens for external services (Google, GitHub, Slack, etc.). Handles automatic token refresh.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: OAUTH_TOOLS,
    metadata: { builtin: true, category: 'authentication' },
    tags: ['authentication', 'oauth', 'credentials'],
    compile_hints: 'get_access_token returns a short-lived access_token string. Always call this immediately before making an authenticated API request — do not cache or reuse across workflow steps.',
    credential_providers: [],
  },
  {
    name: 'long-tail-claude-code',
    description:
      'Agentic coding assistant via Claude Code CLI. Execute development tasks: code generation, refactoring, ' +
      'file analysis, shell commands, codebase search, and multi-step development workflows. ' +
      'Runs as a scoped subprocess with delegation-based authentication for per-user API key resolution.',
    transport_type: 'stdio',
    transport_config: { builtin: true, process: 'in-memory' },
    tool_manifest: CLAUDE_CODE_TOOLS,
    metadata: { builtin: true, category: 'development' },
    tags: ['development', 'coding', 'ai-agent', 'terminal', 'code-generation'],
    compile_hints:
      'execute_task runs Claude Code as a subprocess — it is itself an agentic tool. ' +
      'The `prompt` parameter is ALWAYS a dynamic trigger input — it defines the task and must never ' +
      'be baked as a stored default. `max_turns` and `allowed_tools` are fixed implementation details. ' +
      'Keep prompts self-contained: include all context the task needs since Claude Code ' +
      'starts with no prior conversation. For read-only analysis, restrict with ' +
      'allowed_tools: ["Read", "Grep", "Glob"]. Results may be large; extract specific ' +
      'fields in subsequent steps rather than passing the full result.',
    credential_providers: ['anthropic'],
  },
];
