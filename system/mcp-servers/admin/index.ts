/**
 * Long Tail Admin MCP Server
 *
 * Unified system management — every tool maps directly to a REST API
 * route handler. The tools are organized by route file:
 *
 *   tasks.ts               — routes/tasks.ts
 *   escalations.ts         — routes/escalations/ (incl. metadata + bulk)
 *   workflow-config.ts     — routes/workflows/config.ts
 *   workflows.ts           — routes/workflows/discovery.ts + invocation.ts
 *   mcp-servers.ts         — routes/mcp.ts
 *   yaml-workflows.ts      — routes/yaml-workflows/
 *   users.ts               — routes/users.ts + routes/roles.ts
 *   maintenance.ts         — routes/dba.ts
 *   agents.ts              — routes/agents.ts
 *   agent-subscriptions.ts — routes/agents.ts (subscription sub-routes)
 *   bot-accounts.ts        — routes/bot-accounts.ts
 *   controlplane.ts        — routes/controlplane.ts
 *   pipelines.ts           — routes/pipelines.ts
 *   topics.ts              — routes/topics.ts
 *   settings.ts            — routes/settings.ts
 *   exports.ts             — routes/exports.ts
 *
 * This server replaces three previously separate servers:
 *   - long-tail-db-query (read-only task/escalation/health queries)
 *   - long-tail-workflow-compiler (compile + deploy)
 *   - mcp-workflows-longtail (list + get + invoke compiled workflows)
 *
 * The long-tail-human-queue server remains separate because
 * escalate_and_wait has special durable signal semantics that
 * are deeply wired into the YAML worker infrastructure.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loggerRegistry } from '../../../lib/logger';

import { registerTaskTools } from './tasks';
import { registerEscalationTools } from './escalations';
import { registerWorkflowConfigTools } from './workflow-config';
import { registerWorkflowTools } from './workflows';
import { registerMcpServerTools } from './mcp-servers';
import { registerYamlWorkflowTools } from './yaml-workflows';
import { registerUserTools } from './users';
import { registerMaintenanceTools } from './maintenance';
import { registerAgentTools } from './agents';
import { registerAgentSubscriptionTools } from './agent-subscriptions';
import { registerBotAccountTools } from './bot-accounts';
import { registerControlPlaneTools } from './controlplane';
import { registerPipelineTools } from './pipelines';
import { registerTopicTools } from './topics';
import { registerSettingsTools } from './settings';
import { registerExportTools } from './exports';
import { registerOverviewTools } from './overview';
import { registerDiagnosticsTools } from './diagnostics';

const TOOL_COUNT = 84;

let server: McpServer | null = null;

export async function createAdminServer(options?: {
  name?: string;
  fresh?: boolean;
}): Promise<McpServer> {
  if (server && !options?.fresh) return server;

  const name = options?.name || 'long-tail-admin';
  const instance = new McpServer({ name, version: '1.0.0' });

  if (!options?.fresh) {
    server = instance;
  }

  registerTaskTools(instance);              //  2 tools
  registerEscalationTools(instance);        // 20 tools (RO + RW single + metadata + bulk)
  registerWorkflowConfigTools(instance);    //  3 tools
  registerWorkflowTools(instance);          //  3 tools
  registerMcpServerTools(instance);         //  4 tools
  registerYamlWorkflowTools(instance);      //  5 tools
  registerUserTools(instance);              //  7 tools (users + roles)
  registerMaintenanceTools(instance);       //  1 tool
  registerAgentTools(instance);             //  5 tools
  registerAgentSubscriptionTools(instance); //  3 tools
  registerBotAccountTools(instance);        //  7 tools
  registerControlPlaneTools(instance);      //  5 tools
  registerPipelineTools(instance);          //  4 tools
  registerTopicTools(instance);             //  5 tools
  registerSettingsTools(instance);          //  1 tool
  registerExportTools(instance);            //  4 tools
  registerOverviewTools(instance);          //  1 tool
  registerDiagnosticsTools(instance);       //  3 tools
  // Total: 83

  loggerRegistry.info(`[lt-mcp:admin] ${name} ready (${TOOL_COUNT} tools registered)`);
  return instance;
}

export function getAdminServer(): McpServer | null {
  return server;
}

export async function stopAdminServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:admin] stopped');
  }
}
