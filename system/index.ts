/**
 * System workers and built-in MCP server factories.
 *
 * All declarations carry inline `config` that seeds the DB on first boot.
 * DB is the source of truth after seeding — startup never overwrites.
 */

import type { LTWorkerConfig, LTMcpServerConfig } from '../types/startup';

// ── Tool manifests (static JSON schema data) ────────────────────────────────

import { HUMAN_QUEUE_TOOLS } from './seed/tool-manifests-escalation';
import { TRANSLATION_TOOLS, VISION_ANALYSIS_TOOLS, FILE_STORAGE_TOOLS, HTTP_FETCH_TOOLS, SCHEMA_EXCHANGE_TOOLS, DOCS_TOOLS, OAUTH_TOOLS } from './seed/tool-manifests-data';
import { PLAYWRIGHT_TOOLS, PLAYWRIGHT_CLI_TOOLS } from './seed/tool-manifests-browser';
import { CLAUDE_CODE_TOOLS } from './seed/tool-manifests-workflows';
import { ADMIN_TOOLS } from './seed/tool-manifests-admin';
import { KNOWLEDGE_TOOLS } from './seed/tool-manifests-knowledge';

// Gmail is an example connector — loaded conditionally (not in npm package)
let GMAIL_TOOLS: any[] = [];
try { GMAIL_TOOLS = require('../examples/seed/tool-manifests-gmail').GMAIL_TOOLS; } catch { /* not available */ }

// ── Role constants ──────────────────────────────────────────────────────────

const SYSTEM_ROLES = ['reviewer', 'engineer', 'admin'];
const ENGINEER = 'engineer';

// ── System workflow configs ─────────────────────────────────────────────────

const SYSTEM_WORKFLOW_BASE: Partial<LTWorkerConfig> = {
  defaultRole: ENGINEER,
  roles: SYSTEM_ROLES,
  invocable: false,
};

const systemWorkflowConfigs: Record<string, LTWorkerConfig> = {
  mcpTriageRouter: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Triage router — discovers compiled workflows for remediation, routes to deterministic or dynamic triage',
  },
  mcpTriageDeterministic: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Deterministic triage — invokes matched compiled workflows for escalation remediation',
  },
  mcpTriage: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Dynamic MCP triage — LLM agentic loop for escalation remediation',
  },
  mcpQueryRouter: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Do anything with tools — browser automation, file operations, HTTP requests, database queries, document processing, and more',
    envelopeSchema: {
      data: { prompt: 'Describe what you want to accomplish using available tools...' },
      metadata: { source: 'dashboard' },
    },
  },
  mcpQuery: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Dynamic MCP tool orchestration — LLM agentic loop with raw MCP tools',
  },
  mcpDeterministic: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Deterministic execution — invokes matched compiled YAML workflows with extracted inputs',
  },
  mcpWorkflowBuilder: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Direct pipeline builder — LLM constructs DAG from tool schemas',
  },
  mcpWorkflowPlanner: {
    ...SYSTEM_WORKFLOW_BASE,
    description: 'Plan mode — decomposes specifications into multi-workflow sets',
  },
};

// ── System workers ──────────────────────────────────────────────────────────

export type SystemWorkerEntry = {
  taskQueue: string;
  workflow: (...args: any[]) => any;
  config?: LTWorkerConfig;
};

export function getSystemWorkers(): SystemWorkerEntry[] {
  const workers: SystemWorkerEntry[] = [];
  const hasLLM = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (hasLLM) {
    const pairs: Array<{ mod: string; name: string }> = [
      { mod: './workflows/mcp-triage-router', name: 'mcpTriageRouter' },
      { mod: './workflows/mcp-triage-deterministic', name: 'mcpTriageDeterministic' },
      { mod: './workflows/mcp-triage', name: 'mcpTriage' },
      { mod: './workflows/mcp-query-router', name: 'mcpQueryRouter' },
      { mod: './workflows/mcp-query', name: 'mcpQuery' },
      { mod: './workflows/mcp-deterministic', name: 'mcpDeterministic' },
      { mod: './workflows/mcp-workflow-builder', name: 'mcpWorkflowBuilder' },
      { mod: './workflows/mcp-workflow-planner', name: 'mcpWorkflowPlanner' },
    ];
    for (const { mod, name } of pairs) {
      try {
        const wf = require(mod)[name];
        workers.push({
          taskQueue: 'long-tail-system',
          workflow: wf,
          config: systemWorkflowConfigs[name],
        });
      } catch { /* module not available */ }
    }
  }

  return workers;
}

// ── Built-in MCP server factories ───────────────────────────────────────────

export type McpServerFactoryEntry = {
  factory: () => Promise<any>;
  config: LTMcpServerConfig;
};

export const builtinMcpServerFactories: Record<string, McpServerFactoryEntry> = {
  'long-tail-human-queue': {
    factory: () => import('./mcp-servers/human-queue').then((m) => m.createHumanQueueServer()),
    config: {
      description: 'Built-in escalation and human queue management. Exposes the escalation API as MCP tools for AI agents and remediation workflows.',
      tags: ['escalation', 'human-queue', 'routing'],
      compileHints: [
        'escalate_and_wait creates a durable pause point.',
        'The step AFTER escalate_and_wait is always a signal step (kind: "signal") that receives the human response.',
        'Fields from the signal step output (e.g., password) must be wired via data_flow edges to ALL downstream steps that need them.',
      ].join(' '),
      toolManifest: HUMAN_QUEUE_TOOLS,
    },
  },
  'long-tail-translation': {
    factory: () => import('./mcp-servers/translation').then((m) => m.createTranslationServer()),
    config: {
      description: 'Text translation using LLM. Translates content between languages with automatic source language detection.',
      tags: ['translation', 'language', 'text-processing'],
      credentialProviders: ['anthropic'],
      toolManifest: TRANSLATION_TOOLS,
    },
  },
  'long-tail-vision': {
    factory: () => import('./mcp-servers/vision').then((m) => m.createVisionServer()),
    config: {
      description: 'Image analysis and description using LLM vision. Analyzes images to extract structured data, text content, and descriptions.',
      tags: ['vision', 'image-analysis', 'multimodal'],
      compileHints: [
        'Vision tools process one image at a time.',
        'The argument name is `image` (NOT `image_path`). It accepts a storage path, data URI, or https:// URL.',
        'Vision tools do NOT use browser sessions. Do NOT wire page_id or _handle to vision tools.',
        'analyze_image output fields: description (string), text_content (string), objects (array).',
      ].join(' '),
      credentialProviders: ['anthropic'],
      toolManifest: VISION_ANALYSIS_TOOLS,
    },
  },
  'long-tail-playwright': {
    factory: () => import('./mcp-servers/playwright').then((m) => m.createPlaywrightServer()),
    config: {
      description: 'Low-level browser automation via Playwright. Fine-grained control: navigate, click, fill, wait_for, evaluate, run_script.',
      tags: ['browser-automation', 'testing', 'screenshots'],
      compileHints: [
        'Session fields (_handle, page_id) MUST be threaded from the step that created them to EVERY subsequent browser step.',
        'run_script accepts a `steps` array — fixed implementation detail, never a dynamic input.',
        'run_script exposes `screenshots` (array) and `last_screenshot_path` (string) as output fields.',
      ].join(' '),
      toolManifest: PLAYWRIGHT_TOOLS,
    },
  },
  'long-tail-playwright-cli': {
    factory: () => import('./mcp-servers/playwright-cli').then((m) => m.createPlaywrightCliServer()),
    config: {
      description: 'High-level browser automation. Intent-based tools that handle session management, timing, and error recovery internally.',
      tags: ['browser-automation', 'screenshots', 'scraping', 'forms'],
      compileHints: [
        'Session fields (_handle, page_id) MUST be threaded from producing step to ALL subsequent browser steps.',
        'extract_content returns `links` (structured array) and `script_result` (raw). Use `links` as the source field.',
        'capture_page screenshot_path MUST include a file extension (.png).',
      ].join(' '),
      toolManifest: PLAYWRIGHT_CLI_TOOLS,
    },
  },
  'long-tail-docs': {
    factory: () => import('./mcp-servers/docs').then((m) => m.createDocsServer()),
    config: {
      description: 'Product documentation search and retrieval. List, search, and read Long Tail documentation.',
      tags: ['documentation', 'help', 'reference'],
      toolManifest: DOCS_TOOLS,
    },
  },
  'long-tail-file-storage': {
    factory: () => import('./mcp-servers/file-storage').then((m) => m.createFileStorageServer()),
    config: {
      description: 'Managed file storage for reading, writing, listing, and deleting files.',
      tags: ['storage', 'files', 'io'],
      toolManifest: FILE_STORAGE_TOOLS,
    },
  },
  'long-tail-http-fetch': {
    factory: () => import('./mcp-servers/http-fetch').then((m) => m.createHttpFetchServer()),
    config: {
      description: 'HTTP client tools for making GET, POST, and arbitrary HTTP requests.',
      tags: ['http', 'api', 'fetch', 'network'],
      compileHints: 'HTTP response bodies may be large. Prefer specific fields from parsed JSON rather than raw body.',
      toolManifest: HTTP_FETCH_TOOLS,
    },
  },
  'long-tail-oauth': {
    factory: () => import('./mcp-servers/oauth').then((m) => m.createOAuthServer()),
    config: {
      description: 'OAuth token management. Get fresh access tokens for external services. Handles automatic token refresh.',
      tags: ['authentication', 'oauth', 'credentials'],
      compileHints: 'get_access_token returns a short-lived token. Call immediately before authenticated API requests — do not cache across steps.',
      toolManifest: OAUTH_TOOLS,
    },
  },
  'long-tail-claude-code': {
    factory: () => import('./mcp-servers/claude-code').then((m) => m.createClaudeCodeServer()),
    config: {
      description: 'Agentic coding assistant via Claude Code CLI. Execute development tasks: code generation, refactoring, file analysis, and multi-step workflows.',
      tags: ['development', 'coding', 'ai-agent', 'terminal', 'code-generation'],
      compileHints:
        'execute_task runs Claude Code as a subprocess. The `prompt` parameter is ALWAYS a dynamic trigger input. ' +
        'Keep prompts self-contained. For read-only analysis, restrict with allowed_tools: ["Read", "Grep", "Glob"].',
      credentialProviders: ['anthropic'],
      toolManifest: CLAUDE_CODE_TOOLS,
    },
  },
  'long-tail-admin': {
    factory: () => import('./mcp-servers/admin').then((m) => m.createAdminServer()),
    config: {
      description: 'System administration tools for reflexive self-management. Certify workflows, update server tags, manage roles.',
      tags: ['admin', 'system', 'configuration'],
      compileHints: 'Admin tools modify system configuration. certify_workflow and decertify_workflow change interceptor behavior.',
      toolManifest: ADMIN_TOOLS,
    },
  },
  'long-tail-knowledge': {
    factory: () => import('./mcp-servers/knowledge').then((m) => m.createKnowledgeServer()),
    config: {
      description: 'Persistent knowledge store for autonomous agents. Store, retrieve, search, and accumulate JSONB documents in isolated domains.',
      tags: ['knowledge', 'memory', 'state', 'storage'],
      compileHints:
        'store_knowledge: domain (string), key (string), data (object — MUST be JSON object, never string). ' +
        'Upserts by domain+key. search_knowledge uses JSONB containment (@>). ' +
        'append_knowledge adds to arrays without replacing. list_domains returns all domains with counts.',
      toolManifest: KNOWLEDGE_TOOLS,
    },
  },
  'long-tail-schema-exchange': {
    factory: () => import('./mcp-servers/schema-exchange').then((m) => m.createSchemaExchangeServer()),
    config: {
      description: 'Schema-driven data exchange with external service endpoints. Validates requests and responses against JSON Schema.',
      tags: ['api', 'schema', 'exchange', 'validation', 'fetch'],
      compileHints:
        'Validates requests before sending and responses after receiving. ' +
        'Embed request_schema and response_schema as STATIC values. ' +
        'Exchange output: { status, data, headers, elapsed_ms, validated }. API response is in .data field. ' +
        'For auth, prefer credential_provider over manual token wiring.',
      toolManifest: SCHEMA_EXCHANGE_TOOLS,
    },
  },
};

// Gmail is an example connector — only register when available (not in npm package)
if (GMAIL_TOOLS.length > 0) {
  builtinMcpServerFactories['long-tail-gmail'] = {
    factory: () => import('../examples/mcp-servers/gmail').then((m) => m.createGmailServer()),
    config: {
      description: 'Gmail tools — search, read, summarize, extract, and draft emails using your connected Google account.',
      tags: ['gmail', 'email', 'messaging', 'google'],
      compileHints:
        'Requires a connected Google account (OAuth). gmail_search finds messages, gmail_read gets full content, ' +
        'gmail_summarize for threads, gmail_extract for structured data, gmail_draft for composing.',
      credentialProviders: ['google'],
      toolManifest: GMAIL_TOOLS,
    },
  };
}
