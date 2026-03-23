import * as yamlDb from '../../../services/yaml-workflow/db';
import * as yamlDeployer from '../../../services/yaml-workflow/deployer';

/**
 * Invoke a compiled YAML workflow by name with explicit inputs.
 * The YAML workflow's stored tool_arguments provide defaults;
 * the provided inputs override them.
 */
export async function invokeCompiledWorkflow(
  workflowName: string,
  inputs: Record<string, any>,
): Promise<any> {
  const wf = await yamlDb.getYamlWorkflowByName(workflowName);
  if (!wf || wf.status !== 'active') {
    return { error: `Compiled workflow "${workflowName}" is not active` };
  }
  try {
    const { job_id, result } = await yamlDeployer.invokeYamlWorkflowSync(
      wf.app_id, wf.graph_topic, inputs, undefined, wf.graph_topic,
    );
    return { job_id, workflow: workflowName, status: 'completed', result };
  } catch (err: any) {
    return { error: err.message, workflow: workflowName, args: inputs };
  }
}
