import { HotMesh } from '@hotmeshio/hotmesh';
import type { StreamData, StreamDataResponse } from '@hotmeshio/hotmesh/build/types/stream';

import { getConnection } from '../../../lib/db';
import { loggerRegistry } from '../../../lib/logger';
import { exchangeTokensInArgs } from '../../iam/ephemeral';
import * as mcpClient from '../../mcp/client';
import * as yamlDb from '../db';
import type { LTYamlWorkflowRecord } from '../../../types/yaml-workflow';

import { wrapWithScope } from './scope';
import { buildLlmCallback, buildTransformCallback } from './callbacks';
import { wrapWithEvents } from './events';

/** Track which topics already have registered workers */
const registeredTopics = new Set<string>();

/**
 * Register HotMesh workers for all activities in a YAML workflow.
 * Each worker delegates based on tool_source:
 * - 'db'  -> callDbTool() (internal DB MCP server)
 * - 'mcp' -> mcpClient.callServerTool() (external MCP servers)
 * - 'llm' -> callLLM() with prompt template interpolation
 */
export async function registerWorkersForWorkflow(
  workflow: LTYamlWorkflowRecord,
): Promise<void> {
  const defaultRetry = {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: 30,
  };

  const workerConfigs: Array<{
    topic: string;
    workflowName?: string;
    connection: ReturnType<typeof getConnection>;
    retry: { maximumAttempts: number; backoffCoefficient: number; maximumInterval: number };
    callback: (data: StreamData) => Promise<StreamDataResponse>;
  }> = [];

  // Clear previously registered workers for this workflow so redeployments
  // pick up updated manifests (e.g., new hook_topic bindings).
  for (const a of workflow.activity_manifest) {
    if (a.type === 'worker') {
      const key = a.workflow_name ? `${a.topic}:${a.workflow_name}` : a.topic;
      registeredTopics.delete(key);
    }
  }

  // Build lookup: for escalate_and_wait workers, find the following hook's topic
  const hookTopicByEscalationTool = new Map<string, string>();
  for (const hookAct of workflow.activity_manifest.filter(a => a.type === 'hook' && a.hook_topic)) {
    // Find the worker that transitions TO this hook — it's the escalation tool
    // Convention: the escalation worker's activity_id precedes the hook in sequence
    const hookIdx = workflow.activity_manifest.indexOf(hookAct);
    if (hookIdx > 0) {
      const preceding = workflow.activity_manifest[hookIdx - 1];
      if (preceding.mcp_tool_name === 'escalate_and_wait') {
        hookTopicByEscalationTool.set(preceding.activity_id, hookAct.hook_topic!);
      }
    }
  }

  const workerActivities = workflow.activity_manifest.filter(
    (a) => {
      if (a.type !== 'worker') return false;
      const key = a.workflow_name ? `${a.topic}:${a.workflow_name}` : a.topic;
      return !registeredTopics.has(key);
    },
  );
  const totalSteps = workerActivities.length;
  let stepIndex = 0;

  for (const activity of workerActivities) {
    const currentStep = stepIndex++;
    const toolSource = activity.tool_source || (activity.mcp_server_id === 'db' ? 'db' : 'mcp');
    const wrap = (cb: (data: StreamData) => Promise<StreamDataResponse>) =>
      wrapWithEvents(activity, workflow.app_id, currentStep, totalSteps, wrapWithScope(cb));

    if (toolSource === 'transform') {
      // Transform/reshape step — deterministic data mapping between steps
      workerConfigs.push({
        topic: activity.topic,
        workflowName: activity.workflow_name,
        connection: getConnection(),
        retry: defaultRetry,
        callback: wrap(buildTransformCallback(activity)),
      });
    } else if (toolSource === 'llm') {
      // LLM interpretation step
      workerConfigs.push({
        topic: activity.topic,
        workflowName: activity.workflow_name,
        connection: getConnection(),
        retry: defaultRetry,
        callback: wrap(buildLlmCallback(activity)),
      });
    } else if (toolSource === 'db') {
      if (!activity.mcp_tool_name) continue;
      const toolName = activity.mcp_tool_name;
      const dbServerId = activity.mcp_server_id || 'long-tail-db';
      const toolArgs = activity.tool_arguments;
      workerConfigs.push({
        topic: activity.topic,
        workflowName: activity.workflow_name,
        connection: getConnection(),
        retry: defaultRetry,
        callback: wrap(async (data: StreamData): Promise<StreamDataResponse> => {
          const wfName = (data.data as any)?.workflowName || activity.workflow_name || toolName;
          loggerRegistry.debug(`[yaml-workflow:worker] entering db/${toolName} wf=${wfName} argKeys=[${Object.keys(data.data || {}).join(',')}]`);
          const args = (data.data || {}) as Record<string, unknown>;
          let mergedArgs = toolArgs ? { ...toolArgs, ...args } : args;
          delete mergedArgs._scope;
          delete mergedArgs.workflowName;
          mergedArgs = await exchangeTokensInArgs(mergedArgs);
          const result = await mcpClient.callServerTool(dbServerId, toolName, mergedArgs);
          loggerRegistry.debug(`[yaml-workflow:worker] leaving db/${toolName} wf=${wfName} resultKeys=[${Object.keys(result || {}).join(',')}]`);
          return { metadata: { ...data.metadata }, data: result };
        }),
      });
    } else {
      if (!activity.mcp_tool_name) continue;
      const toolName = activity.mcp_tool_name;
      const serverId = activity.mcp_server_id;
      if (!serverId) continue;
      const storedArgs = activity.tool_arguments;
      const yamlHookTopic = hookTopicByEscalationTool.get(activity.activity_id);
      // Identify keys that are wired via input_mappings. When a wired key
      // resolves to nothing (upstream step failed/returned null), we must
      // NOT fall back to stored tool_arguments — that would leak hardcoded
      // values from the original execution trace.
      const wiredKeys = new Set(
        Object.keys(activity.input_mappings || {}).filter(k => k !== '_scope' && k !== 'workflowName'),
      );
      if (toolName === 'escalate_and_wait') {
        loggerRegistry.info(`[yaml-workflow] escalate_and_wait worker: activityId=${activity.activity_id}, hookTopic=${yamlHookTopic || 'NONE'}, mapKeys=[${[...hookTopicByEscalationTool.keys()].join(',')}]`);
      }
      workerConfigs.push({
        topic: activity.topic,
        workflowName: activity.workflow_name,
        connection: getConnection(),
        retry: defaultRetry,
        callback: wrap(async (data: StreamData): Promise<StreamDataResponse> => {
          const wfName = (data.data as any)?.workflowName || activity.workflow_name || toolName;
          loggerRegistry.debug(`[yaml-workflow:worker] entering mcp/${toolName} wf=${wfName} server=${serverId} argKeys=[${Object.keys(data.data || {}).join(',')}]`);
          const args = (data.data || {}) as Record<string, unknown>;
          // Start from stored defaults, then strip any wired keys that
          // didn't arrive (upstream failure) so stale defaults don't leak.
          const mergedArgs = storedArgs ? { ...storedArgs } : {};
          for (const wk of wiredKeys) {
            if (!(wk in args)) delete mergedArgs[wk];
          }
          for (const [key, value] of Object.entries(args)) {
            if (key === '_scope' || key === 'workflowName') continue;
            if (value !== undefined) {
              mergedArgs[key] = value;
            }
          }
          loggerRegistry.debug(`[yaml-workflow:worker] merged mcp/${toolName} wf=${wfName} mergedKeys=[${Object.keys(mergedArgs).join(',')}]`);
          // For escalate_and_wait: inject YAML signal routing so the MCP tool
          // stores engine:'yaml' + hookTopic + jobId in the escalation metadata
          if (yamlHookTopic) {
            const jid = (data.metadata as any)?.jid;
            mergedArgs._yaml_signal_routing = {
              engine: 'yaml',
              appId: workflow.app_id,
              hookTopic: yamlHookTopic,
              jobId: jid,
              workflowType: workflow.graph_topic,
              workflowId: jid,
              taskQueue: workflow.app_id,
            };
          }
          const exchangedArgs = await exchangeTokensInArgs(mergedArgs);
          const result = await mcpClient.callServerTool(serverId, toolName, exchangedArgs);
          if (result && typeof result === 'object' && 'error' in result) {
            loggerRegistry.error(`[yaml-workflow:worker] ${toolName} error: ${JSON.stringify(result).slice(0, 200)}`);
          }
          if (result == null) {
            loggerRegistry.warn(`[yaml-workflow:worker] ${toolName} returned null/undefined`);
          }
          loggerRegistry.debug(`[yaml-workflow:worker] leaving mcp/${toolName} wf=${wfName} resultKeys=[${Object.keys(result || {}).join(',')}]`);
          return { metadata: { ...data.metadata }, data: result };
        }),
      });
    }

    const regKey = activity.workflow_name ? `${activity.topic}:${activity.workflow_name}` : activity.topic;
    registeredTopics.add(regKey);
  }

  if (workerConfigs.length === 0) return;

  await HotMesh.init({
    appId: workflow.app_id,
    guid: `compiled::${workflow.graph_topic}-${HotMesh.guid()}`,
    engine: {
      connection: getConnection(),
      retry: {
        maximumAttempts: 3,
        backoffCoefficient: 2,
        maximumInterval: '30s',
      },
    },
    workers: workerConfigs,
  });

  loggerRegistry.info(
    `[yaml-workflow] registered ${workerConfigs.length} workers for ${workflow.app_id}`,
  );
}

/**
 * Register workers for all active YAML workflows.
 * Groups by app_id so flows sharing a namespace share a single engine/connection pool.
 * Called at startup in workers/index.ts.
 */
export async function registerAllActiveWorkers(): Promise<void> {
  loggerRegistry.info('[yaml-workflow] checking for active YAML workflows...');
  try {
    const workflows = await yamlDb.getActiveYamlWorkflows();
    loggerRegistry.info(`[yaml-workflow] found ${workflows.length} active workflow(s)`);
    if (workflows.length === 0) return;

    // Group by app_id to register all workers for the same app together
    const byAppId = new Map<string, LTYamlWorkflowRecord[]>();
    for (const wf of workflows) {
      const group = byAppId.get(wf.app_id) || [];
      group.push(wf);
      byAppId.set(wf.app_id, group);
    }

    for (const [appId, group] of byAppId) {
      try {
        for (const wf of group) {
          await registerWorkersForWorkflow(wf);
        }
        loggerRegistry.info(
          `[yaml-workflow] ${appId}: registered workers for ${group.length} flow(s)`,
        );
      } catch (err: any) {
        loggerRegistry.error(
          `[yaml-workflow] failed to register workers for ${appId}: ${err.message}`,
        );
      }
    }
  } catch (err: any) {
    // Table may not exist yet if migration hasn't run
    if (err.message?.includes('does not exist')) {
      loggerRegistry.info('[yaml-workflow] table not yet created, skipping worker registration');
      return;
    }
    loggerRegistry.error(`[yaml-workflow] startup worker registration failed: ${err.message}`);
  }
}
