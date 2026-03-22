import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../logger';
import * as yamlGenerator from '../yaml-workflow/generator';
import * as yamlDb from '../yaml-workflow/db';
import * as yamlDeployer from '../yaml-workflow/deployer';
import * as yamlWorkers from '../yaml-workflow/workers';

let server: McpServer | null = null;

// ── Schemas (extracted to break TS2589 deep-instantiation in registerTool generics) ──

const convertSchema = z.object({
  workflow_id: z.string().describe('The workflow execution ID to analyze'),
  task_queue: z.string().describe('HotMesh task queue (e.g., "long-tail-examples")'),
  workflow_name: z.string().describe('Workflow name (e.g., "reviewContent")'),
  yaml_name: z.string().describe('Name for the generated YAML workflow'),
  description: z.string().optional().describe('Optional description'),
});

const deploySchema = z.object({
  yaml_workflow_id: z.string().describe('UUID of the stored YAML workflow'),
  activate: z.boolean().optional().default(false)
    .describe('Whether to activate immediately after deployment'),
});

const listSchema = z.object({
  status: z.enum(['draft', 'deployed', 'active', 'archived']).optional()
    .describe('Filter by status'),
  limit: z.number().int().min(1).max(100).optional().default(25)
    .describe('Maximum number of results'),
  offset: z.number().int().min(0).optional().default(0)
    .describe('Pagination offset'),
});

/**
 * Create the Workflow Compiler MCP server.
 *
 * Provides tools for converting MCP tool call sequences into
 * deterministic HotMesh YAML workflows:
 * - convert_execution_to_yaml — analyze execution and generate YAML
 * - deploy_yaml_workflow — deploy and optionally activate
 * - list_yaml_workflows — list stored YAML workflows
 */
export async function createWorkflowCompilerServer(options?: {
  name?: string;
}): Promise<McpServer> {
  if (server) return server;

  const name = options?.name || 'workflow-compiler';
  server = new McpServer({ name, version: '1.0.0' });

  // ── convert_execution_to_yaml ─────────────────────────────────────
  (server as any).registerTool(
    'convert_execution_to_yaml',
    {
      title: 'Convert Execution to YAML',
      description:
        'Analyze a completed workflow execution and convert its tool call sequence ' +
        'into a deterministic HotMesh YAML workflow. Extracts callLLM→callDbTool pairs ' +
        'and mcp_* activities, replacing LLM reasoning with direct tool-to-tool data piping. ' +
        'The generated YAML is stored as a draft that can be deployed and activated.',
      inputSchema: convertSchema,
    },
    async (args: z.infer<typeof convertSchema>) => {
      const result = await yamlGenerator.generateYamlFromExecution({
        workflowId: args.workflow_id,
        taskQueue: args.task_queue,
        workflowName: args.workflow_name,
        name: args.yaml_name,
        description: args.description,
      });

      const record = await yamlDb.createYamlWorkflow({
        name: args.yaml_name,
        description: args.description,
        app_id: result.appId,
        yaml_content: result.yaml,
        graph_topic: result.graphTopic,
        input_schema: result.inputSchema,
        output_schema: result.outputSchema,
        activity_manifest: result.activityManifest,
        source_workflow_id: args.workflow_id,
        source_workflow_type: args.workflow_name,
        metadata: { input_field_meta: result.inputFieldMeta },
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            yaml_workflow_id: record.id,
            app_id: record.app_id,
            activity_count: result.activityManifest.filter((a) => a.type === 'worker').length,
            input_schema: result.inputSchema,
            input_field_meta: result.inputFieldMeta,
            yaml_preview: result.yaml.slice(0, 500),
            ...(result.compilationPlan ? {
              compilation: {
                intent: result.compilationPlan.intent,
                core_steps: result.compilationPlan.coreStepIndices.length,
                has_iteration: result.compilationPlan.hasIteration,
                llm_refined: true,
              },
            } : { compilation: { llm_refined: false } }),
          }),
        }],
      };
    },
  );

  // ── deploy_yaml_workflow ──────────────────────────────────────────
  (server as any).registerTool(
    'deploy_yaml_workflow',
    {
      title: 'Deploy YAML Workflow',
      description:
        'Deploy a stored YAML workflow to HotMesh. Optionally activate it immediately ' +
        'and register workers so it can receive invocations.',
      inputSchema: deploySchema,
    },
    async (args: z.infer<typeof deploySchema>) => {
      const wf = await yamlDb.getYamlWorkflow(args.yaml_workflow_id);
      if (!wf) throw new Error('YAML workflow not found');

      await yamlDeployer.deployYamlWorkflow(wf.app_id, wf.yaml_content);
      await yamlDb.updateYamlWorkflowStatus(wf.id, 'deployed');

      let status = 'deployed';
      if (args.activate) {
        await yamlDeployer.activateYamlWorkflow(wf.app_id, wf.app_version);
        await yamlWorkers.registerWorkersForWorkflow(wf);
        await yamlDb.updateYamlWorkflowStatus(wf.id, 'active');
        status = 'active';
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status,
            app_id: wf.app_id,
            graph_topic: wf.graph_topic,
          }),
        }],
      };
    },
  );

  // ── list_yaml_workflows ───────────────────────────────────────────
  (server as any).registerTool(
    'list_yaml_workflows',
    {
      title: 'List YAML Workflows',
      description:
        'List stored YAML workflows with optional status filter. ' +
        'Returns workflow metadata including name, status, source, and activity count.',
      inputSchema: listSchema,
    },
    async (args: z.infer<typeof listSchema>) => {
      const { workflows, total } = await yamlDb.listYamlWorkflows({
        status: args.status as any,
        limit: args.limit,
        offset: args.offset,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: workflows.length,
            workflows: workflows.map((wf) => ({
              id: wf.id,
              name: wf.name,
              app_id: wf.app_id,
              status: wf.status,
              source_workflow_type: wf.source_workflow_type,
              activity_count: wf.activity_manifest.filter((a) => a.type === 'worker').length,
              graph_topic: wf.graph_topic,
              created_at: wf.created_at,
            })),
          }),
        }],
      };
    },
  );

  loggerRegistry.info(`[lt-mcp] workflow compiler server created: ${name}`);
  return server;
}

export function getWorkflowCompilerServer(): McpServer | null {
  return server;
}

export async function stopWorkflowCompilerServer(): Promise<void> {
  if (server) {
    await (server as any).close?.();
    server = null;
  }
}
