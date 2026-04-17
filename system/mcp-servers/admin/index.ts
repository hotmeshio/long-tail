/**
 * Long Tail Admin MCP Server
 *
 * Unified system management — every tool maps directly to a REST API
 * route handler. The tools are organized by route file:
 *
 *   tasks.ts           — routes/tasks.ts
 *   escalations.ts     — routes/escalations/
 *   workflow-config.ts  — routes/workflows/config.ts
 *   workflows.ts       — routes/workflows/discovery.ts + invocation.ts
 *   mcp-servers.ts     — routes/mcp.ts
 *   yaml-workflows.ts  — routes/yaml-workflows/
 *   users.ts           — routes/users.ts + routes/roles.ts
 *   maintenance.ts     — routes/dba.ts
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

const TOOL_COUNT = 30;

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

  registerTaskTools(instance);          //  2 tools
  registerEscalationTools(instance);    //  5 tools
  registerWorkflowConfigTools(instance); // 3 tools
  registerWorkflowTools(instance);      //  3 tools
  registerMcpServerTools(instance);     //  4 tools
  registerYamlWorkflowTools(instance);  //  5 tools
  registerUserTools(instance);          //  7 tools (users + roles)
  registerMaintenanceTools(instance);   //  1 tool
  // Subtotal: 30 — but let me recount...
  // tasks: find_tasks, get_process_detail = 2
  // escalations: find_escalations, get_escalation_stats, claim_escalation, release_expired_claims, bulk_triage = 5
  // workflow-config: list_workflow_configs, upsert_workflow_config, delete_workflow_config = 3
  // workflows: list_discovered_workflows, invoke_workflow, get_workflow_status = 3
  // mcp-servers: list_mcp_servers, update_mcp_server, connect_mcp_server, disconnect_mcp_server = 4
  // yaml-workflows: list_yaml_workflows, get_yaml_workflow, create_yaml_workflow, deploy_yaml_workflow, invoke_yaml_workflow = 5
  // users: list_users, create_user, add_user_role, remove_user_role, list_roles, create_role, add_escalation_chain = 7
  // maintenance: prune = 1
  // Total: 30

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
