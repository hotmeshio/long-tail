import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { StreamData, StreamDataResponse } from '@hotmeshio/hotmesh/build/types/stream';

import { postgres_options } from '../../modules/config';
import {
  LLM_MAX_ARRAY_ITEMS,
  LLM_MAX_INPUT_CHARS,
  LLM_MAX_TOKENS_JSON,
  LLM_MODEL_SECONDARY,
} from '../../modules/defaults';

import { loggerRegistry } from '../logger';
import { publishActivityEvent } from '../events/publish';
import { runWithToolContext } from '../iam/context';
import { exchangeTokensInArgs } from '../iam/ephemeral';
import type { ToolContext, ToolPrincipal } from '../../types/tool-context';
import * as mcpClient from '../mcp/client';
import { callLLM as callLLMService } from '../llm';
import type { ChatMessage, LLMResponse } from '../llm';

/**
 * Build a ToolContext from the `_scope` input parameter.
 * YAML activities receive `_scope` threaded from the trigger through every step.
 */
function buildToolContextFromScope(scope: Record<string, any>): ToolContext {
  return {
    principal: scope.principal as ToolPrincipal,
    ...(scope.initiatingPrincipal
      ? { initiatingPrincipal: scope.initiatingPrincipal as ToolPrincipal }
      : {}),
    credentials: {
      scopes: scope.scopes ?? [],
    },
    trace: {},
  };
}

/**
 * Wrap a worker callback with scope injection via AsyncLocalStorage.
 * If `_scope` is present in the input data, builds a ToolContext and
 * wraps the callback so `getToolContext()` works inside tool code.
 */
function wrapWithScope(
  callback: (data: StreamData) => Promise<StreamDataResponse>,
): (data: StreamData) => Promise<StreamDataResponse> {
  return async (data: StreamData): Promise<StreamDataResponse> => {
    const input = (data.data || {}) as Record<string, unknown>;
    const scope = input._scope as Record<string, any> | undefined;
    if (scope?.principal) {
      const ctx = buildToolContextFromScope(scope);
      return runWithToolContext(ctx, () => callback(data));
    }
    return callback(data);
  };
}

interface CallLLMOptions {
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
}

/** Call the LLM with messages and optional format options. */
async function callWorkerLLM(
  messages: ChatMessage[],
  options?: CallLLMOptions,
): Promise<LLMResponse> {
  return callLLMService({
    model: LLM_MODEL_SECONDARY,
    max_tokens: options?.max_tokens ?? LLM_MAX_TOKENS_JSON,
    messages,
    ...(options?.response_format ? { response_format: options.response_format } : {}),
  });
}
import * as yamlDb from './db';
import type { LTYamlWorkflowRecord, ActivityManifestEntry } from '../../types/yaml-workflow';

/** Track which topics already have registered workers */
const registeredTopics = new Set<string>();

/**
 * Compact input data for LLM consumption: truncate large arrays and
 * strip fields that are unhelpful for summarization (ids, trace data).
 */
export function compactForLlm(input: Record<string, unknown>): Record<string, unknown> {
  const omitKeys = new Set(['trace_id', 'span_id', 'resolved_at']);
  const compact = (val: unknown): unknown => {
    if (Array.isArray(val)) {
      const mapped = val.map(compact);
      if (mapped.length > LLM_MAX_ARRAY_ITEMS) {
        return [...mapped.slice(0, LLM_MAX_ARRAY_ITEMS), `... (${mapped.length - LLM_MAX_ARRAY_ITEMS} more)`];
      }
      return mapped;
    }
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        if (!omitKeys.has(k)) out[k] = compact(v);
      }
      return out;
    }
    return val;
  };
  return compact(input) as Record<string, unknown>;
}

/**
 * Build an LLM worker callback that interpolates a prompt template with
 * input data and calls the LLM for interpretation/synthesis.
 */
function buildLlmCallback(activity: ActivityManifestEntry) {
  return async (data: StreamData): Promise<StreamDataResponse> => {
    const rawInput = (data.data || {}) as Record<string, unknown>;
    const input = compactForLlm(rawInput);
    const template = activity.prompt_template || '';
    const model = activity.model || LLM_MODEL_SECONDARY;

    // Serialize and enforce hard character limit
    let inputJson = JSON.stringify(input, null, 2);
    if (inputJson.length > LLM_MAX_INPUT_CHARS) {
      inputJson = inputJson.slice(0, LLM_MAX_INPUT_CHARS) + '\n... (truncated)';
    }

    // Parse the template into messages. Format: [role]\ncontent\n\n[role]\ncontent
    const messages: Array<{ role: string; content: string }> = [];
    const parts = template.split(/\n\n(?=\[(?:system|user|assistant)\])/);
    for (const part of parts) {
      const roleMatch = part.match(/^\[(\w+)\]\n([\s\S]*)$/);
      if (roleMatch) {
        let content = roleMatch[2];
        // Interpolate {field} placeholders with input data
        // {input_data} is a special placeholder for the full JSON input
        content = content.replace(/\{input_data\}/g, inputJson);
        content = content.replace(/\{(\w+)\}/g, (_, key) => {
          if (key in input) return String(input[key]);
          return `{${key}}`;
        });
        messages.push({ role: roleMatch[1], content });
      } else if (part.trim()) {
        messages.push({ role: 'user', content: part.trim() });
      }
    }

    if (messages.length === 0) {
      messages.push({ role: 'user', content: `Analyze the following data:\n${inputJson}` });
    }

    // Call the LLM with JSON mode for structured output
    const response = await callWorkerLLM(messages as any, {
      max_tokens: LLM_MAX_TOKENS_JSON,
      response_format: { type: 'json_object' },
    });
    const content = response.content || '';

    // Try to parse JSON from the response
    let result: unknown;
    try {
      const cleaned = content
        .replace(/^```(?:json)?\s*/m, '')
        .replace(/\s*```$/m, '')
        .trim();
      result = JSON.parse(cleaned);
    } catch {
      result = { response: content };
    }

    loggerRegistry.info(`[yaml-workflow] LLM step completed (model: ${model}, topic: ${activity.topic})`);
    return {
      metadata: { ...data.metadata },
      data: result as Record<string, unknown>,
    };
  };
}

/**
 * Apply a derivation strategy to produce a computed value from a source string.
 */
function applyDerivation(
  value: string,
  spec: NonNullable<NonNullable<ActivityManifestEntry['transform_spec']>['derivations']>[string],
): string {
  let result = value;
  switch (spec.strategy) {
    case 'slugify': {
      // Extract path from URL if it looks like a URL, otherwise use raw value
      try {
        const url = new URL(result);
        result = url.pathname.replace(/^\//, '').replace(/\//g, '-') || 'home';
      } catch {
        result = result.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      if (spec.prefix) result = spec.prefix + result;
      if (spec.suffix) result = result + spec.suffix;
      break;
    }
    case 'prefix':
      result = (spec.prefix || '') + result + (spec.suffix || '');
      break;
    case 'template':
      result = (spec.template || '{value}').replace(/\{value\}/g, result);
      break;
    case 'passthrough':
      break;
  }
  return result;
}

/**
 * Build a transform worker callback that reshapes array data between steps.
 * Applies field renames, defaults, and derivations.
 */
function buildTransformCallback(activity: ActivityManifestEntry) {
  const spec = activity.transform_spec;
  if (!spec) throw new Error(`Transform activity ${activity.activity_id} missing transform_spec`);

  return async (data: StreamData): Promise<StreamDataResponse> => {
    const input = (data.data || {}) as Record<string, unknown>;
    const sourceData = input[spec.sourceField];

    if (!Array.isArray(sourceData)) {
      // Pass through non-array data unchanged
      return {
        metadata: { ...data.metadata },
        data: { [spec.targetField]: sourceData, ...input },
      };
    }

    // Resolve dynamic directory prefix from trigger inputs (e.g., screenshot_dir)
    const dirKeys = ['screenshot_dir', 'screenshots_dir', 'output_dir'];
    const dynamicDir = dirKeys.reduce<string | null>(
      (found, key) => found || (input[key] ? String(input[key]) : null), null,
    );

    const reshaped = sourceData.map((item: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};

      // Apply field map: target key → source key
      for (const [targetKey, sourceKey] of Object.entries(spec.fieldMap)) {
        if (sourceKey !== null) {
          out[targetKey] = item[sourceKey];
        } else if (spec.derivations?.[targetKey]) {
          // Computed field: use dynamic dir when available for path derivations
          const derivation = { ...spec.derivations[targetKey] };
          if (dynamicDir && targetKey.includes('path')) {
            derivation.prefix = dynamicDir.replace(/\/$/, '') + '/';
          }
          const sourceValue = String(item[derivation.sourceKey] || '');
          out[targetKey] = applyDerivation(sourceValue, derivation);
        }
      }

      // Apply defaults
      if (spec.defaults) {
        for (const [key, value] of Object.entries(spec.defaults)) {
          if (!(key in out)) out[key] = value;
        }
      }

      return out;
    });

    // Return reshaped data alongside any other input fields (session handles, etc.)
    const result: Record<string, unknown> = { ...input, [spec.targetField]: reshaped };
    return {
      metadata: { ...data.metadata },
      data: result,
    };
  };
}

/**
 * Wrap a worker callback with activity lifecycle event publishing.
 * Publishes activity.started before and activity.completed/failed after.
 */
function wrapWithEvents(
  activity: ActivityManifestEntry,
  appId: string,
  stepIndex: number,
  totalSteps: number,
  callback: (data: StreamData) => Promise<StreamDataResponse>,
): (data: StreamData) => Promise<StreamDataResponse> {
  return async (data: StreamData): Promise<StreamDataResponse> => {
    const meta = data.metadata as { jid?: string; wfn?: string };
    const jid = meta?.jid || 'unknown';
    const wfn = meta?.wfn || appId;
    const eventBase = {
      workflowId: jid,
      workflowName: wfn,
      taskQueue: appId,
      activityName: activity.activity_id,
      data: {
        title: activity.title,
        toolName: activity.mcp_tool_name,
        toolSource: activity.tool_source,
        stepIndex,
        totalSteps,
      },
    };

    publishActivityEvent({ type: 'activity.started', ...eventBase });
    try {
      const result = await callback(data);
      publishActivityEvent({ type: 'activity.completed', ...eventBase });
      return result;
    } catch (err: any) {
      loggerRegistry.error(
        `[yaml-worker] ${activity.activity_id} failed: ${err.message}`,
      );
      publishActivityEvent({
        type: 'activity.failed',
        ...eventBase,
        data: { ...eventBase.data, error: err.message },
      });
      // Return the error as data instead of throwing — prevents HotMesh
      // retry storms when the engine reprocesses failed stream messages.
      return {
        metadata: { ...data.metadata },
        data: { error: err.message, is_error: true },
      };
    }
  };
}

/**
 * Register HotMesh workers for all activities in a YAML workflow.
 * Each worker delegates based on tool_source:
 * - 'db'  → callDbTool() (internal DB MCP server)
 * - 'mcp' → mcpClient.callServerTool() (external MCP servers)
 * - 'llm' → callLLM() with prompt template interpolation
 */
export async function registerWorkersForWorkflow(
  workflow: LTYamlWorkflowRecord,
): Promise<void> {
  const workerConfigs: Array<{
    topic: string;
    workflowName?: string;
    connection: { class: typeof Postgres; options: typeof postgres_options };
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
        connection: { class: Postgres, options: postgres_options },
        callback: wrap(buildTransformCallback(activity)),
      });
    } else if (toolSource === 'llm') {
      // LLM interpretation step
      workerConfigs.push({
        topic: activity.topic,
        workflowName: activity.workflow_name,
        connection: { class: Postgres, options: postgres_options },
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
        connection: { class: Postgres, options: postgres_options },
        callback: wrap(async (data: StreamData): Promise<StreamDataResponse> => {
          const args = (data.data || {}) as Record<string, unknown>;
          let mergedArgs = toolArgs ? { ...toolArgs, ...args } : args;
          delete mergedArgs._scope;
          delete mergedArgs.workflowName;
          mergedArgs = await exchangeTokensInArgs(mergedArgs);
          const result = await mcpClient.callServerTool(dbServerId, toolName, mergedArgs);
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
      if (toolName === 'escalate_and_wait') {
        loggerRegistry.info(`[yaml-workflow] escalate_and_wait worker: activityId=${activity.activity_id}, hookTopic=${yamlHookTopic || 'NONE'}, mapKeys=[${[...hookTopicByEscalationTool.keys()].join(',')}]`);
      }
      workerConfigs.push({
        topic: activity.topic,
        workflowName: activity.workflow_name,
        connection: { class: Postgres, options: postgres_options },
        callback: wrap(async (data: StreamData): Promise<StreamDataResponse> => {
          const args = (data.data || {}) as Record<string, unknown>;
          const mergedArgs = storedArgs ? { ...storedArgs } : {};
          for (const [key, value] of Object.entries(args)) {
            if (key === '_scope' || key === 'workflowName') continue;
            if (value !== undefined && value !== null && value !== '') {
              mergedArgs[key] = value;
            }
          }
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
    engine: {
      connection: { class: Postgres, options: postgres_options },
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
