import * as yamlDeployer from './deployer';
import { resolvePrincipal } from '../iam/principal';
import type { LTYamlWorkflowRecord } from '../../types/yaml-workflow';

interface InvokeOptions {
  data?: Record<string, unknown>;
  sync?: boolean;
  timeout?: number;
  execute_as?: string;
  userId?: string;
  /** Source identifier for metadata injection (e.g., 'cron') */
  source?: string;
}

/**
 * Invoke a YAML workflow with scope injection.
 * Shared by HTTP route and cron callback.
 */
export async function invokeYamlWorkflow(
  wf: LTYamlWorkflowRecord,
  options: InvokeOptions = {},
): Promise<{ job_id: string; result?: unknown }> {
  const data: Record<string, unknown> = { ...(options.data || {}) };

  // Inject _scope so compiled workflow activities have identity context
  if (!data._scope) {
    const executeAs = options.execute_as;
    const userId = options.userId;

    if (executeAs) {
      const [botPrincipal, invokerPrincipal] = await Promise.all([
        resolvePrincipal(executeAs),
        userId ? resolvePrincipal(userId) : Promise.resolve(null),
      ]);
      if (botPrincipal) {
        data._scope = {
          principal: botPrincipal,
          scopes: ['mcp:tool:call'],
          ...(invokerPrincipal ? { initiatedBy: userId, initiatingPrincipal: invokerPrincipal } : {}),
        };
      }
    } else if (userId) {
      const principal = await resolvePrincipal(userId);
      if (principal) {
        data._scope = { principal, scopes: ['mcp:tool:call'] };
      }
    }
  }

  if (options.source) {
    if (!data._metadata) data._metadata = {};
    (data._metadata as Record<string, unknown>).source = options.source;
  }

  if (options.sync) {
    const { job_id, result } = await yamlDeployer.invokeYamlWorkflowSync(
      wf.app_id,
      wf.graph_topic,
      data,
      options.timeout,
      wf.graph_topic,
    );
    return { job_id, result };
  }

  const jobId = await yamlDeployer.invokeYamlWorkflow(
    wf.app_id,
    wf.graph_topic,
    data,
    wf.graph_topic,
  );
  return { job_id: jobId };
}
