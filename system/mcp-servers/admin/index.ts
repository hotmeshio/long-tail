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
 *   personas.ts            — routes/personas.ts + persona sub-routes on routes/users.ts
 *   maintenance.ts         — routes/dba.ts
 *   agents.ts              — routes/agents.ts
 *   agent-subscriptions.ts — routes/agents.ts (subscription sub-routes)
 *   bot-accounts.ts        — routes/bot-accounts.ts
 *   controlplane.ts        — routes/controlplane.ts
 *   pipelines.ts           — routes/pipelines.ts
 *   topics.ts              — routes/topics.ts
 *   settings.ts            — routes/settings.ts
 *   exports.ts             — routes/exports.ts
 *   scan-codes.ts          — routes/scan-codes.ts
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
import { registeredToolCount, removeTools } from '../../../services/mcp/registered-tools';
import { durableProviderRegistry } from '../../../services/durable-provider';

import { registerTaskTools } from './tasks';
import { registerEscalationTools } from './escalations';
import { registerWorkflowConfigTools } from './workflow-config';
import { registerWorkflowTools } from './workflows';
import { registerMcpServerTools } from './mcp-servers';
import { registerYamlWorkflowTools } from './yaml-workflows';
import { registerUserTools } from './users';
import { registerPersonaTools } from './personas';
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
import { registerScanCodeTools } from './scan-codes';
import { registerLabelTools } from './labels';
import { registerIdentifierTools } from './identifiers';
import { registerDomainContextTools } from './domain-context';
import { registerAnnouncementTools } from './announcements';

/** Tools in engine-neutral groups that read or start HotMesh workflows. */
const HOTMESH_ONLY_TOOLS = [
  'list_export_jobs',
  'export_workflow_state',
  'get_workflow_envelopes',
  'get_export_status',
  'list_discovered_workflows',
  'invoke_workflow',
  'invoke_workflow_read_safe',
  'get_workflow_status',
  'bulk_triage',
];

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

  const native = durableProviderRegistry.isNative;
  if (native) registerTaskTools(instance);
  registerEscalationTools(instance);
  if (native) registerWorkflowConfigTools(instance);
  registerWorkflowTools(instance);
  registerMcpServerTools(instance);
  if (native) registerYamlWorkflowTools(instance);
  registerUserTools(instance);
  registerPersonaTools(instance);
  if (native) registerMaintenanceTools(instance);
  registerAgentTools(instance);
  registerAgentSubscriptionTools(instance);
  registerBotAccountTools(instance);
  if (native) registerControlPlaneTools(instance);
  if (native) registerPipelineTools(instance);
  registerTopicTools(instance);
  registerSettingsTools(instance);
  registerExportTools(instance);
  registerOverviewTools(instance);
  if (native) registerDiagnosticsTools(instance);
  registerScanCodeTools(instance);
  registerLabelTools(instance);
  registerIdentifierTools(instance);
  registerDomainContextTools(instance);
  registerAnnouncementTools(instance);
  if (!native) removeTools(instance, HOTMESH_ONLY_TOOLS);

  loggerRegistry.info(`[lt-mcp:admin] ${name} ready (${registeredToolCount(instance)} tools registered)`);
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
