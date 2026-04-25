/**
 * Persistence activities for the workflow planner.
 * These are side-effect functions that update the database.
 */

import type { PlanItem, LTWorkflowSetStatus } from '../../../../types/workflow-set';
import {
  updateWorkflowSetPlan,
  updateWorkflowSetStatus,
} from '../../../../services/workflow-sets';
import {
  createYamlWorkflow,
  listYamlWorkflowsByAppId,
  updateYamlWorkflowStatus,
  updateYamlWorkflowVersion,
  markAppIdContentDeployed,
} from '../../../../services/yaml-workflow/db';
import { deployAppId } from '../../../../services/yaml-workflow/deployer';
import { registerWorkersForWorkflow } from '../../../../services/yaml-workflow/workers';
import type { CreateYamlWorkflowInput } from '../../../../services/yaml-workflow/types';

export async function persistPlan(
  setId: string,
  planItems: PlanItem[],
): Promise<void> {
  const namespaces = [...new Set(planItems.map(w => w.namespace))];
  await updateWorkflowSetPlan(setId, planItems, namespaces);
}

export interface BuiltWorkflowData {
  name: string;
  description: string;
  yaml_content: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  activity_manifest: unknown[];
  tags: string[];
  graph_topic: string;
}

export async function persistBuiltWorkflow(
  setId: string,
  planItem: PlanItem,
  builderOutput: BuiltWorkflowData,
): Promise<string> {
  const input: CreateYamlWorkflowInput = {
    name: builderOutput.name,
    description: builderOutput.description,
    app_id: planItem.namespace,
    yaml_content: builderOutput.yaml_content,
    graph_topic: builderOutput.graph_topic || builderOutput.name,
    input_schema: builderOutput.input_schema,
    output_schema: builderOutput.output_schema,
    activity_manifest: builderOutput.activity_manifest as any,
    tags: builderOutput.tags || [],
    source_workflow_type: 'mcpWorkflowPlanner',
    set_id: setId,
    set_role: planItem.role,
    set_build_order: planItem.build_order,
  };

  const record = await createYamlWorkflow(input);
  return record.id;
}

export async function updateSetStatus(
  setId: string,
  status: LTWorkflowSetStatus,
): Promise<void> {
  await updateWorkflowSetStatus(setId, status);
}

export async function deploySetNamespaces(
  namespaces: string[],
): Promise<void> {
  for (const namespace of namespaces) {
    await deployAppId(namespace, '1');

    // Register workers and activate all workflows in this namespace
    const siblings = await listYamlWorkflowsByAppId(namespace);
    for (const sibling of siblings) {
      await updateYamlWorkflowVersion(sibling.id, '1');
      await registerWorkersForWorkflow(sibling);
      if (sibling.status === 'draft' || sibling.status === 'deployed') {
        await updateYamlWorkflowStatus(sibling.id, 'active');
      }
    }
    await markAppIdContentDeployed(namespace);
  }
}
