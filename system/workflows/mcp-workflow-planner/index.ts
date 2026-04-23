import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn } from '../../../types';
import type { PlanItem } from '../../../types/workflow-set';
import { executeLT } from '../../../services/orchestrator';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  generatePlan,
  persistPlan,
  persistBuiltWorkflow,
  updateSetStatus,
  deploySetNamespaces,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

/**
 * Plan mode workflow — decomposes a specification into N workflows,
 * builds them leaf-first by delegating to mcpWorkflowBuilder,
 * and deploys the resulting set.
 */
export async function mcpWorkflowPlanner(
  envelope: LTEnvelope,
): Promise<LTReturn> {
  const { specification, setId } = envelope.data as {
    specification: string;
    setId: string;
  };

  // 1. Generate plan from specification
  const planResult = await generatePlan(specification);

  // 2. Persist the plan to the workflow set
  await persistPlan(setId, planResult.workflows);

  // 3. Build each workflow in dependency order (leaf-first)
  await updateSetStatus(setId, 'building');

  const builtWorkflows: Array<{
    name: string;
    id: string;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    graph_topic: string;
  }> = [];

  for (const planItem of planResult.workflows) {
    // Build context for the builder: sibling schemas for composition wiring
    const siblingSchemas = builtWorkflows.map(w => ({
      name: w.name,
      input_schema: w.input_schema,
      output_schema: w.output_schema,
      graph_topic: w.graph_topic,
    }));

    // Delegate to the existing builder workflow
    const builderResult = await executeLT<LTReturn>({
      workflowName: 'mcpWorkflowBuilder',
      args: [{
        data: {
          prompt: buildPromptForPlanItem(planItem, siblingSchemas),
          tags: [],
          composition_context: {
            sibling_schemas: siblingSchemas,
            dependencies: planItem.dependencies,
            namespace: planItem.namespace,
            requires_await: planItem.dependencies.some(
              dep => planResult.workflows.find(w => w.name === dep)?.namespace === planItem.namespace,
            ),
          },
        },
        metadata: envelope.metadata,
        lt: envelope.lt,
      }],
      taskQueue: 'long-tail-system',
    });

    const builderData = builderResult.data as Record<string, any>;

    // Persist the built workflow with set membership
    const yamlId = await persistBuiltWorkflow(setId, planItem, {
      name: builderData.name || planItem.name,
      description: builderData.description || planItem.description,
      yaml_content: builderData.yaml,
      input_schema: builderData.input_schema || {},
      output_schema: planItem.io_contract.output_schema || {},
      activity_manifest: builderData.activity_manifest || [],
      tags: builderData.tags || [],
      graph_topic: builderData.name || planItem.name,
    });

    builtWorkflows.push({
      name: planItem.name,
      id: yamlId,
      input_schema: builderData.input_schema || {},
      output_schema: planItem.io_contract.output_schema || {},
      graph_topic: builderData.name || planItem.name,
    });
  }

  // 4. Deploy all namespaces
  await updateSetStatus(setId, 'deploying');

  const namespaces = [...new Set(planResult.workflows.map(w => w.namespace))];
  await deploySetNamespaces(namespaces);

  // 5. Mark complete
  await updateSetStatus(setId, 'completed');

  return {
    type: 'return',
    data: {
      title: planResult.plan_name,
      summary: `Built ${builtWorkflows.length} workflows across ${namespaces.length} namespace(s)`,
      set_id: setId,
      workflows: builtWorkflows,
      namespaces,
    },
  };
}

/**
 * Build a detailed prompt for the builder from a plan item.
 * Includes the workflow description, I/O contract, and dependency context.
 */
function buildPromptForPlanItem(
  planItem: PlanItem,
  siblingSchemas: Array<{ name: string; input_schema: Record<string, unknown>; output_schema: Record<string, unknown>; graph_topic: string }>,
): string {
  const parts: string[] = [planItem.description];

  // Add I/O contract
  if (planItem.io_contract.input_schema?.properties) {
    parts.push(`\nInputs: ${JSON.stringify(planItem.io_contract.input_schema, null, 2)}`);
  }
  if (planItem.io_contract.output_schema?.properties) {
    parts.push(`\nOutputs: ${JSON.stringify(planItem.io_contract.output_schema, null, 2)}`);
  }

  // Add dependency context
  if (planItem.dependencies.length > 0) {
    const depSchemas = siblingSchemas.filter(s => planItem.dependencies.includes(s.name));
    if (depSchemas.length > 0) {
      parts.push('\nThis workflow depends on the following sibling workflows:');
      for (const dep of depSchemas) {
        parts.push(`- ${dep.name} (topic: ${dep.graph_topic})`);
        parts.push(`  Input: ${JSON.stringify(dep.input_schema)}`);
        parts.push(`  Output: ${JSON.stringify(dep.output_schema)}`);
      }
    }
  }

  return parts.join('\n');
}
