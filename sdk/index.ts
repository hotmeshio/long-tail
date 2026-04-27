import * as tasksApi from '../api/tasks';
import * as escalationsApi from '../api/escalations';
import * as workflowsApi from '../api/workflows';
import * as yamlWorkflowsApi from '../api/yaml-workflows';
import * as usersApi from '../api/users';
import * as rolesApi from '../api/roles';
import * as authApi from '../api/auth';
import * as mcpApi from '../api/mcp';
import * as mcpRunsApi from '../api/mcp-runs';
import * as insightApi from '../api/insight';
import * as settingsApi from '../api/settings';
import * as exportsApi from '../api/exports';
import * as controlplaneApi from '../api/controlplane';
import * as botAccountsApi from '../api/bot-accounts';
import * as workflowSetsApi from '../api/workflow-sets';
import * as dbaApi from '../api/dba';
import * as namespacesApi from '../api/namespaces';
import * as maintenanceApi from '../api/maintenance';
import { eventRegistry } from '../lib/events';
import { CallbackEventAdapter } from '../lib/events/callback';
import type { LTApiAuth, LTApiResult } from '../types/sdk';
import type { LTEvent, LTEventType } from '../types/events';

/**
 * Options for createClient.
 */
export interface LTClientOptions {
  /** Default auth context bound to every API call. Override per-call if needed. */
  auth?: LTApiAuth;
}

/** Bind auth context to a function that expects it as the last argument. */
function bindAuth<TInput, TResult>(
  fn: (input: TInput, auth: LTApiAuth) => Promise<LTApiResult<TResult>>,
  defaultAuth: LTApiAuth | undefined,
): (input: TInput, auth?: LTApiAuth) => Promise<LTApiResult<TResult>> {
  return (input: TInput, auth?: LTApiAuth) => {
    const resolvedAuth = auth ?? defaultAuth;
    if (!resolvedAuth) {
      return Promise.resolve({ status: 401, error: 'Auth context required' } as LTApiResult<TResult>);
    }
    return fn(input, resolvedAuth);
  };
}

/** Bind optional auth context — passes undefined if not available. */
function bindOptionalAuth<TInput, TResult>(
  fn: (input: TInput, auth?: LTApiAuth) => Promise<LTApiResult<TResult>>,
  defaultAuth: LTApiAuth | undefined,
): (input: TInput, auth?: LTApiAuth) => Promise<LTApiResult<TResult>> {
  return (input: TInput, auth?: LTApiAuth) => fn(input, auth ?? defaultAuth);
}

/**
 * Create a Long Tail SDK client for direct in-process API calls.
 *
 * All operations go through the same API layer as HTTP routes —
 * same validation, same RBAC, same event publishing — without
 * HTTP transport overhead.
 *
 * ```typescript
 * import { createClient } from '@hotmeshio/long-tail/sdk';
 *
 * const lt = createClient({ auth: { userId: 'system' } });
 *
 * const result = await lt.escalations.claim({ id: 'esc_123', durationMinutes: 30 });
 * // { status: 200, data: { escalation: {...}, isExtension: false } }
 *
 * lt.events.on('escalation.claimed', (event) => {
 *   console.log('claimed:', event.escalationId);
 * });
 * ```
 */
export function createClient(options: LTClientOptions = {}) {
  const auth = options.auth;

  // Get or create the CallbackEventAdapter singleton
  let callbackAdapter = eventRegistry.getAdapter(CallbackEventAdapter);
  if (!callbackAdapter) {
    callbackAdapter = new CallbackEventAdapter();
    eventRegistry.register(callbackAdapter);
    callbackAdapter.connect();
  }

  return {
    // ── Tasks ──────────────────────────────────────────────────────────────
    tasks: {
      create: bindAuth(tasksApi.createTask, auth),
      list: tasksApi.listTasks,
      get: tasksApi.getTask,
      listProcesses: tasksApi.listProcesses,
      getProcess: tasksApi.getProcess,
      getProcessStats: tasksApi.getProcessStats,
    },

    // ── Escalations ────────────────────────────────────────────────────────
    escalations: {
      create: bindAuth(escalationsApi.createEscalation, auth),
      list: bindAuth(escalationsApi.listEscalations, auth),
      listAvailable: bindAuth(escalationsApi.listAvailableEscalations, auth),
      listTypes: escalationsApi.listDistinctTypes,
      getStats: bindAuth(escalationsApi.getEscalationStats, auth),
      get: bindAuth(escalationsApi.getEscalation, auth),
      getByWorkflowId: escalationsApi.getEscalationsByWorkflowId,
      escalate: bindAuth(escalationsApi.escalateToRole, auth),
      claim: bindAuth(escalationsApi.claimEscalation, auth),
      release: bindAuth(escalationsApi.releaseEscalation, auth),
      resolve: bindAuth(escalationsApi.resolveEscalation, auth),
      releaseExpired: escalationsApi.releaseExpiredClaims,
      updatePriority: bindAuth(escalationsApi.updatePriority, auth),
      bulkClaim: bindAuth(escalationsApi.bulkClaim, auth),
      bulkAssign: bindAuth(escalationsApi.bulkAssign, auth),
      bulkEscalate: bindAuth(escalationsApi.bulkEscalate, auth),
      bulkTriage: bindAuth(escalationsApi.bulkTriage, auth),
    },

    // ── Workflows ──────────────────────────────────────────────────────────
    workflows: {
      invoke: bindAuth(workflowsApi.invokeWorkflow, auth),
      getStatus: workflowsApi.getWorkflowStatus,
      getResult: workflowsApi.getWorkflowResult,
      terminate: workflowsApi.terminateWorkflow,
      export: workflowsApi.exportWorkflow,
      listWorkers: workflowsApi.listWorkers,
      listDiscovered: workflowsApi.listDiscoveredWorkflows,
      getCronStatus: workflowsApi.getCronStatus,
      listConfigs: workflowsApi.listWorkflowConfigs,
      getConfig: workflowsApi.getWorkflowConfig,
      upsertConfig: workflowsApi.upsertWorkflowConfig,
      deleteConfig: workflowsApi.deleteWorkflowConfig,
    },

    // ── YAML Workflows ─────────────────────────────────────────────────────
    yamlWorkflows: {
      list: yamlWorkflowsApi.listYamlWorkflows,
      create: yamlWorkflowsApi.createYamlWorkflow,
      createDirect: yamlWorkflowsApi.createYamlWorkflowDirect,
      getAppIds: yamlWorkflowsApi.getAppIds,
      get: yamlWorkflowsApi.getYamlWorkflow,
      update: yamlWorkflowsApi.updateYamlWorkflow,
      regenerate: yamlWorkflowsApi.regenerateYamlWorkflow,
      delete: yamlWorkflowsApi.deleteYamlWorkflow,
      deploy: yamlWorkflowsApi.deployYamlWorkflow,
      activate: yamlWorkflowsApi.activateYamlWorkflow,
      invoke: bindOptionalAuth(yamlWorkflowsApi.invokeYamlWorkflow, auth),
      archive: yamlWorkflowsApi.archiveYamlWorkflow,
      getVersionHistory: yamlWorkflowsApi.getVersionHistory,
      getVersionSnapshot: yamlWorkflowsApi.getVersionSnapshot,
      getYamlContent: yamlWorkflowsApi.getYamlContent,
      setCronSchedule: yamlWorkflowsApi.setCronSchedule,
      clearCronSchedule: yamlWorkflowsApi.clearCronSchedule,
      getCronStatus: yamlWorkflowsApi.getCronStatus,
    },

    // ── Users ──────────────────────────────────────────────────────────────
    users: {
      list: usersApi.listUsers,
      get: usersApi.getUser,
      create: usersApi.createUser,
      update: usersApi.updateUser,
      delete: usersApi.deleteUser,
      getRoles: usersApi.getUserRoles,
      addRole: usersApi.addUserRole,
      removeRole: usersApi.removeUserRole,
    },

    // ── Roles ──────────────────────────────────────────────────────────────
    roles: {
      list: rolesApi.listRoles,
      listWithDetails: rolesApi.listRolesWithDetails,
      create: rolesApi.createRole,
      delete: rolesApi.deleteRole,
      getEscalationChains: rolesApi.getEscalationChains,
      addEscalationChain: rolesApi.addEscalationChain,
      removeEscalationChain: rolesApi.removeEscalationChain,
      getEscalationTargets: rolesApi.getEscalationTargets,
      replaceEscalationTargets: rolesApi.replaceEscalationTargets,
    },

    // ── Auth ───────────────────────────────────────────────────────────────
    auth: {
      login: authApi.login,
    },

    // ── MCP ────────────────────────────────────────────────────────────────
    mcp: {
      listServers: mcpApi.listMcpServers,
      createServer: mcpApi.createMcpServer,
      testConnection: mcpApi.testConnection,
      getServer: mcpApi.getMcpServer,
      updateServer: mcpApi.updateMcpServer,
      deleteServer: mcpApi.deleteMcpServer,
      connectServer: mcpApi.connectMcpServer,
      disconnectServer: mcpApi.disconnectMcpServer,
      getCredentialStatus: bindAuth(mcpApi.getCredentialStatus, auth),
      listTools: mcpApi.listMcpServerTools,
      callTool: bindOptionalAuth(mcpApi.callMcpTool, auth),
    },

    // ── MCP Runs ───────────────────────────────────────────────────────────
    mcpRuns: {
      listEntities: mcpRunsApi.listEntities,
      listJobs: mcpRunsApi.listJobs,
      getExecution: mcpRunsApi.getJobExecution,
    },

    // ── Insight ────────────────────────────────────────────────────────────
    insight: {
      mcpQuery: bindOptionalAuth(insightApi.mcpQuery, auth),
      buildWorkflow: bindOptionalAuth(insightApi.buildWorkflow, auth),
      refineWorkflow: bindOptionalAuth(insightApi.refineWorkflow, auth),
      describeWorkflow: insightApi.describeWorkflow,
    },

    // ── Settings ───────────────────────────────────────────────────────────
    settings: {
      get: settingsApi.getSettings,
    },

    // ── Exports ────────────────────────────────────────────────────────────
    exports: {
      listJobs: exportsApi.listJobs,
      exportState: exportsApi.exportWorkflowState,
      exportExecution: exportsApi.exportWorkflowExecution,
      getStatus: exportsApi.getWorkflowStatus,
      getState: exportsApi.getWorkflowState,
    },

    // ── Control Plane ──────────────────────────────────────────────────────
    controlplane: {
      listApps: controlplaneApi.listApps,
      rollCall: controlplaneApi.rollCall,
      throttle: controlplaneApi.applyThrottle,
      getStreamStats: controlplaneApi.getStreamStats,
      subscribe: controlplaneApi.subscribeMesh,
    },

    // ── Bot Accounts ───────────────────────────────────────────────────────
    botAccounts: {
      list: botAccountsApi.listBots,
      get: botAccountsApi.getBot,
      create: bindOptionalAuth(botAccountsApi.createBot, auth),
      update: botAccountsApi.updateBot,
      delete: botAccountsApi.deleteBot,
      getRoles: botAccountsApi.getBotRoles,
      addRole: botAccountsApi.addBotRole,
      removeRole: botAccountsApi.removeBotRole,
      listKeys: botAccountsApi.listBotKeys,
      createKey: botAccountsApi.createBotKey,
      revokeKey: botAccountsApi.revokeBotKey,
    },

    // ── Workflow Sets ──────────────────────────────────────────────────────
    workflowSets: {
      create: bindOptionalAuth(workflowSetsApi.createWorkflowSet, auth),
      list: workflowSetsApi.listWorkflowSets,
      get: workflowSetsApi.getWorkflowSet,
      updatePlan: workflowSetsApi.updateWorkflowSetPlanApi,
      build: workflowSetsApi.buildWorkflowSet,
      deploy: workflowSetsApi.deployWorkflowSet,
    },

    // ── DBA ────────────────────────────────────────────────────────────────
    dba: {
      prune: dbaApi.prune,
      deploy: dbaApi.deploy,
    },

    // ── Namespaces ─────────────────────────────────────────────────────────
    namespaces: {
      list: namespacesApi.listNamespaces,
      register: namespacesApi.registerNamespace,
    },

    // ── Maintenance ────────────────────────────────────────────────────────
    maintenance: {
      getConfig: maintenanceApi.getMaintenanceConfig,
      updateConfig: maintenanceApi.updateMaintenanceConfig,
    },

    // ── Events ─────────────────────────────────────────────────────────────
    events: {
      /**
       * Subscribe to Long Tail events.
       *
       * Supports exact types (`'task.created'`), category wildcards (`'task.*'`),
       * and global wildcard (`'*'`).
       *
       * Returns an unsubscribe function.
       *
       * ```typescript
       * const unsub = lt.events.on('escalation.claimed', (event) => {
       *   console.log('claimed:', event.escalationId);
       * });
       * // Later: unsub();
       * ```
       */
      on: (
        pattern: LTEventType | '*' | (string & {}),
        callback: (event: LTEvent) => void,
      ): (() => void) => {
        return callbackAdapter!.on(pattern, callback);
      },
    },
  };
}

/** The return type of createClient(). */
export type LTClient = ReturnType<typeof createClient>;
