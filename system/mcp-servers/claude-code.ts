import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../lib/logger';
import * as claudeCode from '../activities/claude-code';

// ── Schemas ──────────────────────────────────────────────────────────────────

const executeTaskSchema = z.object({
  prompt: z.string().describe(
    'The task prompt for Claude Code. Be specific and actionable. ' +
    'Claude Code has access to terminal, file system, and code editing tools.',
  ),
  working_directory: z.string().optional().describe(
    'Working directory for the task. Defaults to the server process cwd.',
  ),
  allowed_tools: z.array(z.string()).optional().describe(
    'Restrict which tools Claude Code can use (e.g., ["Read", "Grep", "Glob"]). ' +
    'Omit for unrestricted access.',
  ),
  max_turns: z.number().optional().describe(
    'Maximum agentic turns (tool calls) before stopping. Default: model default.',
  ),
  model: z.string().optional().describe(
    'Override the Claude model (e.g., "claude-sonnet-4-6"). Default: CLI default.',
  ),
  system_prompt: z.string().optional().describe(
    'Additional system prompt to append to Claude Code\'s defaults.',
  ),
  timeout_ms: z.number().optional().describe(
    'Execution timeout in milliseconds. Default: 120000 (2 min), max: 300000 (5 min).',
  ),
  credential_label: z.string().optional().describe(
    'Label of the stored Anthropic credential to use (e.g., "subscription", "api-batch"). ' +
    'Default: "default". Use when the user has multiple Anthropic credentials.',
  ),
});

const checkAvailabilitySchema = z.object({});

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a Claude Code MCP server.
 *
 * Provides 2 tools:
 *   execute_task       — Run a Claude Code prompt, return structured output
 *   check_availability — Verify CLI installation and API key presence
 *
 * Authentication by proxy:
 *   When invoked from a workflow, `_auth` is injected automatically by the
 *   framework. The activity uses `_auth.userId` for audit logging and
 *   `_auth.token` (delegation JWT) for resolving per-user API keys.
 *   Built-in tools that don't need auth simply ignore the `_auth` field.
 */
export async function createClaudeCodeServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-claude-code';
  const instance = new McpServer({ name, version: '1.0.0' });

  (instance as any).registerTool(
    'execute_task',
    {
      title: 'Execute Claude Code Task',
      description:
        'Run a task using Claude Code CLI on the server. Claude Code is an agentic ' +
        'coding assistant with terminal access, file I/O, code search, and editing. ' +
        'Use for: code generation, refactoring, file analysis, running shell commands, ' +
        'searching codebases, and multi-step development tasks. ' +
        'The task runs in a subprocess with a scoped API key and optional tool restrictions. ' +
        'When called from a workflow, the requesting user\'s identity is propagated via delegation.',
      inputSchema: executeTaskSchema,
    },
    async (args: z.infer<typeof executeTaskSchema> & { _auth?: { userId?: string; token?: string } }) => {
      try {
        const result = await claudeCode.executeTask(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: result.is_error,
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    },
  );

  (instance as any).registerTool(
    'check_availability',
    {
      title: 'Check Claude Code Availability',
      description:
        'Verify that the Claude Code CLI is installed and an Anthropic API key is available. ' +
        'Returns version info and key availability. Use before execute_task to verify readiness.',
      inputSchema: checkAvailabilitySchema,
    },
    async (args: z.infer<typeof checkAvailabilitySchema> & { _auth?: { userId?: string; token?: string } }) => {
      const result = await claudeCode.checkAvailability(args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  loggerRegistry.info(`[lt-mcp:claude-code] ${name} ready (2 tools registered)`);
  return instance;
}
