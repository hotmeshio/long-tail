import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { StreamData, StreamDataResponse } from '@hotmeshio/hotmesh/build/types/stream';

import { postgres_options } from '../../modules/config';
import { loggerRegistry } from '../logger';
import { callDbTool } from '../insight/activities';
import * as mcpClient from '../mcp/client';
import * as yamlDb from './db';
import type { LTYamlWorkflowRecord } from '../../types/yaml-workflow';

/** Track which topics already have registered workers */
const registeredTopics = new Set<string>();

/**
 * Register HotMesh workers for all activities in a YAML workflow.
 * Each worker delegates to the corresponding tool based on tool_source:
 * - 'db' → callDbTool() (internal DB MCP server)
 * - 'mcp' → mcpClient.callServerTool() (external MCP servers)
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
    if (!activity.mcp_tool_name) continue;

    const toolName = activity.mcp_tool_name;
    const toolSource = activity.tool_source || (activity.mcp_server_id === 'db' ? 'db' : 'mcp');

    if (toolSource === 'db') {
      // DB tools — route through callDbTool (internal MCP transport)
      workerConfigs.push({
        topic: activity.topic,
        connection: { class: Postgres, options: postgres_options },
        callback: async (data: StreamData): Promise<StreamDataResponse> => {
          const args = (data.data || {}) as Record<string, unknown>;
          // Merge stored default arguments with runtime input
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
 * Called at startup in workers/index.ts.
 */
export async function registerAllActiveWorkers(): Promise<void> {
  try {
    const workflows = await yamlDb.getActiveYamlWorkflows();
    for (const wf of workflows) {
      try {
        await registerWorkersForWorkflow(wf);
      } catch (err: any) {
        loggerRegistry.error(
          `[yaml-workflow] failed to register workers for ${wf.app_id}: ${err.message}`,
        );
      }
    }
    if (workflows.length > 0) {
      loggerRegistry.info(
        `[yaml-workflow] registered workers for ${workflows.length} active workflow(s)`,
      );
    }
  } catch (err: any) {
    // Table may not exist yet if migration hasn't run — silently skip
    if (err.message?.includes('does not exist')) return;
    loggerRegistry.error(`[yaml-workflow] startup worker registration failed: ${err.message}`);
  }
}
