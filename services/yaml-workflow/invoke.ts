import * as yamlDeployer from './deployer';
import { resolvePrincipal } from '../iam/principal';
import { publishWorkflowEvent } from '../../lib/events/publish';
import type { LTYamlWorkflowRecord } from '../../types/yaml-workflow';

interface InvokeOptions {
  data?: Record<string, unknown>;
  sync?: boolean;
  timeout?: number;
  execute_as?: string;
  userId?: string;
  /** Source identifier for metadata injection (e.g., 'cron') */
  source?: string;
  /** Deterministic job ID for idempotent execution (agent subscriptions) */
  jobId?: string;
}

/**
 * The identity context compiled workflow activities run under, from the
 * server-side identity: execute_as with the invoker as initiator, else the
 * invoker. Never read from the caller's data.
 */
async function resolveScope(
  executeAs: string | undefined,
  userId: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (executeAs) {
    const [botPrincipal, invokerPrincipal] = await Promise.all([
      resolvePrincipal(executeAs),
      userId ? resolvePrincipal(userId) : Promise.resolve(null),
    ]);
    if (!botPrincipal) return undefined;
    return {
      principal: botPrincipal,
      scopes: ['mcp:tool:call'],
      ...(invokerPrincipal ? { initiatedBy: userId, initiatingPrincipal: invokerPrincipal } : {}),
    };
  }
  if (!userId) return undefined;
  const principal = await resolvePrincipal(userId);
  return principal ? { principal, scopes: ['mcp:tool:call'] } : undefined;
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
  const scope = await resolveScope(options.execute_as, options.userId);

  if (options.source) {
    if (!data._metadata) data._metadata = {};
    (data._metadata as Record<string, unknown>).source = options.source;
  }

  const wfMeta = {
    workflowName: wf.graph_topic,
    taskQueue: wf.app_id,
  };

  if (options.sync) {
    publishWorkflowEvent({
      type: 'workflow.started',
      source: 'graph',
      workflowId: options.jobId || wf.graph_topic,
      ...wfMeta,
      status: 'running',
    });

    try {
      const { job_id, result } = await yamlDeployer.invokeYamlWorkflowSync(
        wf.app_id,
        wf.graph_topic,
        data,
        options.timeout,
        wf.graph_topic,
        scope,
      );
      publishWorkflowEvent({
        type: 'workflow.completed',
        source: 'graph',
        workflowId: job_id,
        ...wfMeta,
        status: 'completed',
        data: typeof result === 'object' && result !== null ? result as Record<string, any> : undefined,
      });
      return { job_id, result };
    } catch (err: any) {
      publishWorkflowEvent({
        type: 'workflow.failed',
        source: 'graph',
        workflowId: options.jobId || wf.graph_topic,
        ...wfMeta,
        status: 'failed',
        data: { error: err?.message ?? String(err) },
      });
      throw err;
    }
  }

  // Async path — include ngn so HotMesh routes the completion reply back to
  // this engine instance, enabling fire-and-forget lifecycle event tracking.
  const engine = await yamlDeployer.getEngine(wf.app_id);
  const internalEngine = (engine as any).engine;
  const ngn: string | undefined = internalEngine?.guid;

  const context = (options.jobId || ngn)
    ? {
        metadata: {
          ...(options.jobId ? { jid: options.jobId } : {}),
          ...(ngn ? { ngn } : {}),
        },
      } as any
    : undefined;

  const jobId = await yamlDeployer.invokeYamlWorkflow(
    wf.app_id,
    wf.graph_topic,
    data,
    wf.graph_topic,
    context,
    scope,
  );

  publishWorkflowEvent({
    type: 'workflow.started',
    source: 'graph',
    workflowId: jobId,
    ...wfMeta,
    status: 'running',
  });

  // Register a best-effort completion callback. Fires when HotMesh routes the
  // job reply back to this engine (requires ngn set above). Cleans itself up
  // after 5 minutes regardless so there is no unbounded callback accumulation.
  if (ngn && internalEngine?.registerJobCallback) {
    const timeoutMs = 5 * 60_000;
    const timer = setTimeout(
      () => internalEngine.delistJobCallback?.(jobId),
      timeoutMs,
    );
    internalEngine.registerJobCallback(jobId, (_topic: string, output: any) => {
      clearTimeout(timer);
      internalEngine.delistJobCallback?.(jobId);
      const failed = !!output?.metadata?.err;
      publishWorkflowEvent({
        type: failed ? 'workflow.failed' : 'workflow.completed',
        source: 'graph',
        workflowId: jobId,
        ...wfMeta,
        status: failed ? 'failed' : 'completed',
        data: failed
          ? { error: output.metadata.err }
          : (output?.data && typeof output.data === 'object' ? output.data : undefined),
      });
    });
  }

  return { job_id: jobId };
}
