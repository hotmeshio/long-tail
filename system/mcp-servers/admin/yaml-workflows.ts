/**
 * YAML workflow (pipeline) tools — mirrors routes/yaml-workflows/
 *
 * Replaces both the workflow-compiler server (compile + deploy)
 * and the mcp-workflows server (list + get + invoke).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as yamlDb from '../../../services/yaml-workflow/db';
import * as yamlGenerator from '../../../services/yaml-workflow/generator';
import * as yamlDeployer from '../../../services/yaml-workflow/deployer';
import * as yamlWorkers from '../../../services/yaml-workflow/workers';
import { getTaskByWorkflowId } from '../../../services/task';
import {
  listYamlWorkflowsSchema,
  getYamlWorkflowSchema,
  createYamlWorkflowSchema,
  deployYamlWorkflowSchema,
  invokeYamlWorkflowSchema,
} from './schemas';

export function registerYamlWorkflowTools(server: McpServer): void {

  // mirrors GET /api/yaml-workflows
  (server as any).registerTool(
    'list_yaml_workflows',
    {
      title: 'List Pipeline Workflows',
      description:
        'List compiled YAML workflows with optional filters by status, ' +
        'namespace, or search term. Returns name, status, source, and activity count.',
      inputSchema: listYamlWorkflowsSchema,
    },
    async (args: z.infer<typeof listYamlWorkflowsSchema>) => {
      const { workflows, total } = await yamlDb.listYamlWorkflows({
        status: args.status as any,
        app_id: args.app_id,
        search: args.search,
        source_workflow_id: args.source_workflow_id,
        limit: args.limit,
        offset: args.offset,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: workflows.length,
            workflows: workflows.map((w) => ({
              id: w.id,
              name: w.name,
              app_id: w.app_id,
              status: w.status,
              source_workflow_type: w.source_workflow_type,
              graph_topic: w.graph_topic,
              activity_count: (w.activity_manifest as any[])?.filter((a: any) => a.type === 'worker').length ?? 0,
              tags: w.tags,
              created_at: w.created_at,
            })),
          }),
        }],
      };
    },
  );

  // mirrors GET /api/yaml-workflows/:id
  (server as any).registerTool(
    'get_yaml_workflow',
    {
      title: 'Get Pipeline Workflow',
      description:
        'Inspect a compiled workflow by ID. Returns the activity manifest, ' +
        'input/output schemas, YAML content, and provenance.',
      inputSchema: getYamlWorkflowSchema,
    },
    async (args: z.infer<typeof getYamlWorkflowSchema>) => {
      const wf = await yamlDb.getYamlWorkflow(args.id);
      if (!wf) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'YAML workflow not found' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(wf) }],
      };
    },
  );

  // mirrors POST /api/yaml-workflows
  (server as any).registerTool(
    'create_yaml_workflow',
    {
      title: 'Compile Execution to Pipeline',
      description:
        'Generate a deterministic YAML workflow from a completed execution. ' +
        'Extracts the tool call sequence and replaces LLM reasoning with ' +
        'direct tool-to-tool data piping. Stored as a draft.',
      inputSchema: createYamlWorkflowSchema,
    },
    async (args: z.infer<typeof createYamlWorkflowSchema>) => {
      // Reject incomplete executions (same check as route)
      const task = await getTaskByWorkflowId(args.workflow_id);
      if (task) {
        const milestones = task.milestones ?? [];
        if (milestones.some((m: any) => m.name === 'rounds_exhausted')) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Cannot compile: source execution exhausted its tool rounds without completing.',
              }),
            }],
            isError: true,
          };
        }
      }

      const result = await yamlGenerator.generateYamlFromExecution({
        workflowId: args.workflow_id,
        taskQueue: args.task_queue,
        workflowName: args.workflow_name,
        name: args.name,
        description: args.description,
        compilationFeedback: args.compilation_feedback,
      });

      const mergedTags = [...new Set([
        ...(result.tags || []),
        ...(args.tags || []),
      ])];

      const record = await yamlDb.createYamlWorkflow({
        name: args.name,
        description: args.description,
        app_id: result.appId,
        yaml_content: result.yaml,
        graph_topic: result.graphTopic,
        input_schema: result.inputSchema,
        output_schema: result.outputSchema,
        activity_manifest: result.activityManifest,
        tags: mergedTags,
        source_workflow_id: args.workflow_id,
        source_workflow_type: args.workflow_name,
        original_prompt: result.originalPrompt || undefined,
        category: result.category || undefined,
        metadata: {
          input_field_meta: result.inputFieldMeta,
          ...(result.validationIssues?.length ? { validation_warnings: result.validationIssues } : {}),
        },
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: record.id,
            name: record.name,
            app_id: record.app_id,
            status: record.status,
            activity_count: (record.activity_manifest as any[])?.filter((a: any) => a.type === 'worker').length ?? 0,
          }),
        }],
      };
    },
  );

  // mirrors POST /api/yaml-workflows/:id/deploy
  (server as any).registerTool(
    'deploy_yaml_workflow',
    {
      title: 'Deploy Pipeline Workflow',
      description:
        'Deploy a compiled YAML workflow to HotMesh, activate it, and ' +
        'register workers. All sibling workflows sharing the same app_id ' +
        'are deployed together.',
      inputSchema: deployYamlWorkflowSchema,
    },
    async (args: z.infer<typeof deployYamlWorkflowSchema>) => {
      const wf = await yamlDb.getYamlWorkflow(args.id);
      if (!wf) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'YAML workflow not found' }) }],
          isError: true,
        };
      }

      const deployVersion = wf.app_version || '1';
      const siblings = await yamlDb.listYamlWorkflowsByAppId(wf.app_id);
      await yamlDeployer.deployAppId(wf.app_id, deployVersion);

      for (const sibling of siblings) {
        await yamlDb.updateYamlWorkflowVersion(sibling.id, deployVersion);
        await yamlWorkers.registerWorkersForWorkflow(sibling);
        if (sibling.status === 'draft' || sibling.status === 'deployed') {
          await yamlDb.updateYamlWorkflowStatus(sibling.id, 'active');
        }
      }

      await yamlDb.markAppIdContentDeployed(wf.app_id);
      const updated = await yamlDb.getYamlWorkflow(args.id);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            deployed: true,
            id: updated?.id,
            name: updated?.name,
            status: updated?.status,
            app_id: updated?.app_id,
          }),
        }],
      };
    },
  );

  // mirrors POST /api/yaml-workflows/:id/invoke
  (server as any).registerTool(
    'invoke_yaml_workflow',
    {
      title: 'Invoke Pipeline Workflow',
      description:
        'Run a compiled YAML workflow. Deterministic — no LLM reasoning, ' +
        'just direct tool-to-tool data piping. Set sync=true to wait for result.',
      inputSchema: invokeYamlWorkflowSchema,
    },
    async (args: z.infer<typeof invokeYamlWorkflowSchema>) => {
      const wf = await yamlDb.getYamlWorkflow(args.id);
      if (!wf) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'YAML workflow not found' }) }],
          isError: true,
        };
      }
      if (wf.status !== 'active') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Workflow must be active to invoke' }) }],
          isError: true,
        };
      }

      if (args.sync) {
        const { job_id, result } = await yamlDeployer.invokeYamlWorkflowSync(
          wf.app_id, wf.graph_topic, args.data, args.timeout, wf.graph_topic,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ job_id, result }) }],
        };
      }

      const jobId = await yamlDeployer.invokeYamlWorkflow(
        wf.app_id, wf.graph_topic, args.data, wf.graph_topic,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ job_id: jobId }) }],
      };
    },
  );
}
