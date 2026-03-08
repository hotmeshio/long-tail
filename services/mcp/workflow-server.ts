import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../logger';
import * as yamlDb from '../yaml-workflow/db';
import * as yamlDeployer from '../yaml-workflow/deployer';

let server: McpServer | null = null;

// ── Schemas ─────────────────────────────────────────────────────────────────

const listWorkflowsSchema = z.object({
  status: z.enum(['active', 'deployed', 'draft', 'archived']).optional()
    .describe('Filter by lifecycle status. Defaults to "active" (ready to invoke).'),
});

const invokeWorkflowSchema = z.object({
  workflow_name: z.string()
    .describe('Name of the compiled workflow to invoke (from list_workflows)'),
  input: z.record(z.any()).optional().default({})
    .describe('Input data matching the workflow input schema'),
  async: z.boolean().optional().default(false)
    .describe('If true, fire-and-forget (returns job ID). If false, wait for result.'),
  timeout: z.number().optional()
    .describe('Max milliseconds to wait for result (sync mode only). Default: 120000.'),
});

const getWorkflowSchema = z.object({
  workflow_name: z.string()
    .describe('Name of the workflow to inspect'),
});

/**
 * Create the Long Tail MCP Workflows server.
 *
 * Exposes compiled YAML workflows — hardened, deterministic pipelines
 * that were originally discovered through dynamic MCP triage — as
 * invocable MCP tools.
 *
 * Tools:
 * - list_workflows — discover available compiled workflows
 * - get_workflow — inspect a workflow's schema and activity manifest
 * - invoke_workflow — run a workflow (sync or async)
 */
export async function createWorkflowServer(options?: {
  name?: string;
}): Promise<McpServer> {
  if (server) return server;

  const name = options?.name || 'long-tail-mcp-workflows';
  server = new McpServer({ name, version: '1.0.0' });

  // ── list_workflows ──────────────────────────────────────────────────
  (server as any).registerTool(
    'list_workflows',
    {
      title: 'List Compiled Workflows',
      description:
        'List available compiled YAML workflows. These are deterministic pipelines ' +
        'converted from successful MCP triage executions. Each workflow represents ' +
        'a proven solution to a specific edge case (e.g., rotate-and-extract for ' +
        'upside-down documents). Defaults to listing active (invocable) workflows.',
      inputSchema: listWorkflowsSchema,
    },
    async (args: z.infer<typeof listWorkflowsSchema>) => {
      const { workflows } = await yamlDb.listYamlWorkflows({
        status: args.status || 'active',
        limit: 100,
      });
      const items = workflows.map((wf) => ({
        name: wf.name,
        description: wf.description,
        graph_topic: wf.graph_topic,
        source_workflow_type: wf.source_workflow_type,
        input_schema: wf.input_schema,
        output_schema: wf.output_schema,
        activity_count: wf.activity_manifest.filter((a) => a.type === 'worker').length,
        status: wf.status,
        activated_at: wf.activated_at,
      }));
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: items.length, workflows: items }),
        }],
      };
    },
  );

  // ── get_workflow ─────────────────────────────────────────────────────
  (server as any).registerTool(
    'get_workflow',
    {
      title: 'Get Workflow Details',
      description:
        'Inspect a compiled workflow by name. Returns the full activity manifest, ' +
        'input/output schemas, and provenance (which execution it was compiled from).',
      inputSchema: getWorkflowSchema,
    },
    async (args: z.infer<typeof getWorkflowSchema>) => {
      const wf = await yamlDb.getYamlWorkflowByName(args.workflow_name);
      if (!wf) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Workflow "${args.workflow_name}" not found` }),
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            name: wf.name,
            description: wf.description,
            app_id: wf.app_id,
            graph_topic: wf.graph_topic,
            status: wf.status,
            source_workflow_id: wf.source_workflow_id,
            source_workflow_type: wf.source_workflow_type,
            input_schema: wf.input_schema,
            output_schema: wf.output_schema,
            activities: wf.activity_manifest.filter((a) => a.type === 'worker').map((a) => ({
              title: a.title,
              tool_source: a.tool_source,
              mcp_server_id: a.mcp_server_id,
              mcp_tool_name: a.mcp_tool_name,
            })),
            activated_at: wf.activated_at,
            created_at: wf.created_at,
          }),
        }],
      };
    },
  );

  // ── invoke_workflow ──────────────────────────────────────────────────
  (server as any).registerTool(
    'invoke_workflow',
    {
      title: 'Invoke Compiled Workflow',
      description:
        'Run a compiled YAML workflow by name. These are deterministic pipelines — ' +
        'no LLM reasoning, just direct tool-to-tool data piping. Use list_workflows ' +
        'to discover available workflows and their input schemas. ' +
        'Set async=true for fire-and-forget (returns job ID), or leave false to wait for the result.',
      inputSchema: invokeWorkflowSchema,
    },
    async (args: z.infer<typeof invokeWorkflowSchema>) => {
      const wf = await yamlDb.getYamlWorkflowByName(args.workflow_name);
      if (!wf) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Workflow "${args.workflow_name}" not found` }),
          }],
          isError: true,
        };
      }
      if (wf.status !== 'active') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: `Workflow "${args.workflow_name}" is not active (status: ${wf.status})`,
            }),
          }],
          isError: true,
        };
      }

      if (args.async) {
        const jobId = await yamlDeployer.invokeYamlWorkflow(
          wf.app_id,
          wf.graph_topic,
          args.input || {},
        );
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              job_id: jobId,
              workflow: wf.name,
              status: 'started',
            }),
          }],
        };
      }

      const result = await yamlDeployer.invokeYamlWorkflowSync(
        wf.app_id,
        wf.graph_topic,
        args.input || {},
        args.timeout,
      );
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            workflow: wf.name,
            status: 'completed',
            result,
          }),
        }],
      };
    },
  );

  const toolCount = 3;
  loggerRegistry.info(`[lt-mcp:server] ${name} ready (${toolCount} tools registered)`);
  return server;
}

/**
 * Get the current workflow MCP server instance.
 */
export function getWorkflowServer(): McpServer | null {
  return server;
}

/**
 * Stop the workflow MCP server.
 */
export async function stopWorkflowServer(): Promise<void> {
  if (server) {
    await (server as any).close?.();
    server = null;
  }
}
