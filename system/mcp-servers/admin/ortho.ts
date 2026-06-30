/**
 * Ortho pipeline MCP tools — AI-operable interface for the 8-stage manufacturing workflow.
 *
 * ortho_submit          — start a new order through the orthoPipeline workflow
 * ortho_pending         — list open stage escalations waiting for completion
 * ortho_complete_stage  — claim and resolve one stage escalation (advances the pipeline)
 * ortho_status          — get the current status and results for an order workflow
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { invokeWorkflow } from '../../../services/workflow-invocation';
import * as escalationApi from '../../../api/escalations';
import * as workflowApi from '../../../api/workflows';
import { ensureSystemBot } from '../../../services/iam';
import type { LTApiAuth } from '../../../types/sdk';
import { ORTHO_STAGES } from '../../../examples/workflows/ortho-pipeline/types';

let systemPrincipalId: string | null = null;

async function systemAuth(): Promise<LTApiAuth> {
  if (!systemPrincipalId) systemPrincipalId = await ensureSystemBot();
  return { userId: systemPrincipalId, role: 'superadmin' };
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const orthoSubmitSchema = z.object({
  order_id: z.string().describe('Unique order identifier (e.g. "ORD-001")'),
  item_type: z.string().describe('Item type (e.g. "insole-standard", "insole-diabetic")'),
  stages: z.array(z.string()).optional().describe('Override stage sequence (default: all 8 stages)'),
  metadata: z.record(z.unknown()).optional().describe('Additional order metadata passed through to each stage'),
});

const orthoPendingSchema = z.object({
  stage: z.string().optional().describe('Filter to a specific stage (e.g. "design"). Omit for all stages.'),
  limit: z.number().int().optional().default(50).describe('Max results'),
});

const orthoCompleteStageSchema = z.object({
  escalation_id: z.string().describe('Escalation ID returned by ortho_pending'),
  notes: z.string().describe('Completion notes — what was done, any decisions made'),
  outcome: z.record(z.unknown()).optional().describe('Structured outcome data specific to this stage'),
});

const orthoStatusSchema = z.object({
  workflow_id: z.string().describe('Workflow ID returned by ortho_submit'),
});

// ── Tool registration ────────────────────────────────────────────────────────

export function registerOrthoTools(server: McpServer): void {

  // Submit a new order through the ortho manufacturing pipeline
  (server as any).registerTool(
    'ortho_submit',
    {
      title: 'Submit Ortho Order',
      description:
        'Start a new orthotic manufacturing order through the 8-stage pipeline ' +
        '(design → review → print → grid → glue → finish → qa → ship). ' +
        'Returns a workflow_id used to track progress. Each stage creates a pending ' +
        'escalation that must be completed via ortho_complete_stage before the next stage begins.',
      inputSchema: orthoSubmitSchema,
    },
    async (args: z.infer<typeof orthoSubmitSchema>) => {
      const result = await invokeWorkflow({
        workflowType: 'orthoPipeline',
        data: {
          order_id: args.order_id,
          item_type: args.item_type,
          ...(args.stages ? { stages: args.stages } : {}),
          ...(args.metadata ? { metadata: args.metadata } : {}),
        },
        auth: { userId: 'lt-system', role: 'superadmin' },
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            workflow_id: result.workflowId,
            order_id: args.order_id,
            item_type: args.item_type,
            stages: args.stages ?? [...ORTHO_STAGES],
            message: 'Pipeline started — first stage escalation will appear momentarily',
          }),
        }],
      };
    },
  );

  // List pending stage escalations, optionally filtered by stage
  (server as any).registerTool(
    'ortho_pending',
    {
      title: 'List Pending Ortho Stages',
      description:
        'List open ortho-pipeline escalations waiting to be completed. ' +
        'Each entry represents one manufacturing stage blocked on human or AI review. ' +
        'Filter by stage name to focus on one step. Use ortho_complete_stage to advance.',
      inputSchema: orthoPendingSchema,
    },
    async (args: z.infer<typeof orthoPendingSchema>) => {
      const auth = await systemAuth();
      const result = await escalationApi.listEscalations(
        {
          status: 'pending',
          type: 'ortho-stage',
          ...(args.stage ? { subtype: args.stage } : {}),
          limit: args.limit ?? 50,
          sort_by: 'created_at',
          order: 'asc',
        },
        auth,
      );

      if (result.status !== 200 || !result.data) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: result.error ?? 'Failed to list escalations' }),
          }],
        };
      }

      const escalations = (result.data.escalations ?? []).map((e: any) => ({
        id: e.id,
        stage: e.subtype,
        order_id: e.metadata?.order_id,
        item_type: e.metadata?.item_type,
        description: e.description,
        created_at: e.created_at,
        signal_key: e.signal_key,
        workflow_id: e.workflow_id,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: escalations.length, escalations }),
        }],
      };
    },
  );

  // Claim and resolve one stage escalation (advances to the next stage)
  (server as any).registerTool(
    'ortho_complete_stage',
    {
      title: 'Complete Ortho Stage',
      description:
        'Complete a pending ortho pipeline stage. Claims the escalation as the system ' +
        'operator and resolves it with your notes and outcome data. Resolving automatically ' +
        'signals the workflow to advance to the next stage — a new escalation will appear ' +
        'for the subsequent step within seconds.',
      inputSchema: orthoCompleteStageSchema,
    },
    async (args: z.infer<typeof orthoCompleteStageSchema>) => {
      const auth = await systemAuth();

      // Claim first (idempotent if already claimed by us)
      const claimResult = await escalationApi.claimEscalation(
        { id: args.escalation_id, durationMinutes: 60 },
        auth,
      );
      if (claimResult.status !== 200) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Claim failed: ${claimResult.error}` }),
          }],
        };
      }

      // Resolve with stage output
      const resolveResult = await escalationApi.resolveEscalation(
        {
          id: args.escalation_id,
          resolverPayload: {
            notes: args.notes,
            ...(args.outcome ? { outcome: args.outcome } : {}),
          },
        },
        auth,
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            resolved: resolveResult.status === 200,
            escalation_id: args.escalation_id,
            status: resolveResult.status,
            error: resolveResult.status !== 200 ? resolveResult.error : undefined,
            message: resolveResult.status === 200
              ? 'Stage resolved — next stage escalation will appear shortly'
              : undefined,
          }),
        }],
      };
    },
  );

  // Get the current status and accumulated results for a pipeline run
  (server as any).registerTool(
    'ortho_status',
    {
      title: 'Get Ortho Pipeline Status',
      description:
        'Get the current status and completed stage results for an ortho pipeline workflow. ' +
        'Returns "running" while stages are in progress, "complete" with the full stage ' +
        'result history when all stages are done.',
      inputSchema: orthoStatusSchema,
    },
    async (args: z.infer<typeof orthoStatusSchema>) => {
      const statusResult = await workflowApi.getWorkflowStatus({ workflowId: args.workflow_id });

      if (statusResult.status === 404) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Workflow not found', workflow_id: args.workflow_id }),
          }],
        };
      }

      // status=0 means complete in HotMesh
      const isComplete = statusResult.data?.status === 0;

      if (!isComplete) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ workflow_id: args.workflow_id, status: 'running' }),
          }],
        };
      }

      const resultData = await workflowApi.getWorkflowResult({ workflowId: args.workflow_id });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            workflow_id: args.workflow_id,
            status: 'complete',
            result: resultData.data?.result ?? null,
          }),
        }],
      };
    },
  );
}
