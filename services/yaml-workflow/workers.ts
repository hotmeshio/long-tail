import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { StreamData, StreamDataResponse } from '@hotmeshio/hotmesh/build/types/stream';

import { postgres_options } from '../../modules/config';
import { loggerRegistry } from '../logger';
import { callDbTool, callLLM } from '../insight/activities';
import * as mcpClient from '../mcp/client';
import * as yamlDb from './db';
import type { LTYamlWorkflowRecord, ActivityManifestEntry } from '../../types/yaml-workflow';

/** Track which topics already have registered workers */
const registeredTopics = new Set<string>();

/**
 * Build an LLM worker callback that interpolates a prompt template with
 * input data and calls the LLM for interpretation/synthesis.
 */
function buildLlmCallback(activity: ActivityManifestEntry) {
  return async (data: StreamData): Promise<StreamDataResponse> => {
    const input = (data.data || {}) as Record<string, unknown>;
    const template = activity.prompt_template || '';
    const model = activity.model || 'gpt-4o-mini';

    // Parse the template into messages. Format: [role]\ncontent\n\n[role]\ncontent
    const messages: Array<{ role: string; content: string }> = [];
    const parts = template.split(/\n\n(?=\[(?:system|user|assistant)\])/);
    for (const part of parts) {
      const roleMatch = part.match(/^\[(\w+)\]\n([\s\S]*)$/);
      if (roleMatch) {
        let content = roleMatch[2];
        // Interpolate {field} placeholders with input data
        // {input_data} is a special placeholder for the full JSON input
        content = content.replace(/\{input_data\}/g, JSON.stringify(input, null, 2));
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
      messages.push({ role: 'user', content: `Analyze the following data:\n${JSON.stringify(input, null, 2)}` });
    }

    // Call the LLM (reuses the existing activity — no tools, just text completion)
    const response = await callLLM(messages as any);
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
    connection: { class: typeof Postgres; options: typeof postgres_options };
    callback: (data: StreamData) => Promise<StreamDataResponse>;
  }> = [];

  for (const activity of workflow.activity_manifest) {
    if (activity.type !== 'worker') continue;
    if (registeredTopics.has(activity.topic)) continue;

    const toolSource = activity.tool_source || (activity.mcp_server_id === 'db' ? 'db' : 'mcp');

    if (toolSource === 'llm') {
      // LLM interpretation step
      workerConfigs.push({
        topic: activity.topic,
        connection: { class: Postgres, options: postgres_options },
        callback: buildLlmCallback(activity),
      });
    } else if (toolSource === 'db') {
      if (!activity.mcp_tool_name) continue;
      const toolName = activity.mcp_tool_name;
      // DB tools — route through callDbTool (internal MCP transport)
      workerConfigs.push({
        topic: activity.topic,
        connection: { class: Postgres, options: postgres_options },
        callback: async (data: StreamData): Promise<StreamDataResponse> => {
          const args = (data.data || {}) as Record<string, unknown>;
          const mergedArgs = activity.tool_arguments
            ? { ...activity.tool_arguments, ...args }
            : args;
          const result = await callDbTool(toolName, mergedArgs);
          return {
            metadata: { ...data.metadata },
            data: result,
          };
        },
      });
    } else {
      // MCP tools — route through external MCP client
      if (!activity.mcp_tool_name) continue;
      const toolName = activity.mcp_tool_name;
      const serverId = activity.mcp_server_id;
      if (!serverId) continue;

      workerConfigs.push({
        topic: activity.topic,
        connection: { class: Postgres, options: postgres_options },
        callback: async (data: StreamData): Promise<StreamDataResponse> => {
          const result = await mcpClient.callServerTool(
            serverId,
            toolName,
            (data.data || {}) as Record<string, unknown>,
          );
          return {
            metadata: { ...data.metadata },
            data: result,
          };
        },
      });
    }

    registeredTopics.add(activity.topic);
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
