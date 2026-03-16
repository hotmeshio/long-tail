import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { QUERY_LIMIT_DEFAULT, QUERY_LIMIT_MAX } from '../../modules/defaults';
import { loggerRegistry } from '../../services/logger';
import { getPool } from '../../services/db';
import * as taskService from '../../services/task';
import * as escalationService from '../../services/escalation';
import * as configService from '../../services/config';
import {
  HEALTH_TASK_COUNTS,
  HEALTH_ESCALATION_COUNTS,
  HEALTH_ACTIVE_WORKFLOW_TYPES,
  HEALTH_RECENT_ACTIVITY,
} from '../../services/mcp/sql';

let server: McpServer | null = null;

// ── Schemas (extracted to break TS2589 deep-instantiation in registerTool generics) ──

const findTasksSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'needs_intervention', 'completed', 'failed'])
    .optional().describe('Filter by task status'),
  workflow_type: z.string().optional().describe('Filter by workflow type (e.g. "processClaim")'),
  workflow_id: z.string().optional().describe('Filter by workflow execution ID'),
  origin_id: z.string().optional().describe('Filter by origin/process ID to see all tasks in a process'),
  limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional().default(QUERY_LIMIT_DEFAULT)
    .describe('Maximum number of results'),
});

const findEscalationsSchema = z.object({
  status: z.enum(['pending', 'resolved']).optional()
    .describe('Filter by escalation status'),
  role: z.string().optional().describe('Filter by assigned role (e.g. "reviewer", "engineer")'),
  type: z.string().optional().describe('Filter by escalation type'),
  priority: z.number().int().min(1).max(4).optional()
    .describe('Filter by priority (1=critical, 4=low)'),
  limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional().default(QUERY_LIMIT_DEFAULT)
    .describe('Maximum number of results'),
});

const getProcessSummarySchema = z.object({
  workflow_type: z.string().optional()
    .describe('Filter processes to those containing this workflow type'),
  limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional().default(QUERY_LIMIT_DEFAULT)
    .describe('Maximum number of processes'),
});

const getEscalationStatsSchema = z.object({});

const getWorkflowTypesSchema = z.object({});

const getSystemHealthSchema = z.object({});

/**
 * Create the Long Tail DB Query MCP server.
 *
 * Provides read-only query tools against the lt_* tables:
 * - find_tasks — search tasks by status, workflow type, or origin
 * - find_escalations — search escalations by status, role, type
 * - get_process_summary — aggregate process view grouped by origin_id
 * - get_escalation_stats — real-time escalation statistics
 * - get_workflow_types — list registered workflow configurations
 * - get_system_health — overall system health snapshot
 */
export async function createDbServer(options?: {
  name?: string;
  /** When true, skip the singleton cache and create a dedicated instance. */
  fresh?: boolean;
}): Promise<McpServer> {
  if (server && !options?.fresh) return server;

  const name = options?.name || 'long-tail-db-query';
  const instance = new McpServer({ name, version: '1.0.0' });

  // Only cache as the singleton when not a fresh (dedicated) instance
  if (!options?.fresh) {
    server = instance;
  }

  // ── find_tasks ──────────────────────────────────────────────────
  (instance as any).registerTool(
    'find_tasks',
    {
      title: 'Find Tasks',
      description:
        'Search tasks with optional filters. Returns task records with workflow_id, status, ' +
        'workflow_type, milestones, created/completed timestamps, and metadata.',
      inputSchema: findTasksSchema,
    },
    async (args: z.infer<typeof findTasksSchema>) => {
      const { tasks, total } = await taskService.listTasks({
        status: args.status as any,
        workflow_type: args.workflow_type,
        workflow_id: args.workflow_id,
        origin_id: args.origin_id,
        limit: args.limit,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              workflow_id: t.workflow_id,
              workflow_type: t.workflow_type,
              status: t.status,
              priority: t.priority,
              origin_id: t.origin_id,
              created_at: t.created_at,
              completed_at: t.completed_at,
              error: t.error,
              trace_id: t.trace_id,
              span_id: t.span_id,
            })),
          }),
        }],
      };
    },
  );

  // ── find_escalations ────────────────────────────────────────────
  (instance as any).registerTool(
    'find_escalations',
    {
      title: 'Find Escalations',
      description:
        'Search escalations with optional filters. Returns escalation records with type, ' +
        'role, priority, status, description, and assignment info.',
      inputSchema: findEscalationsSchema,
    },
    async (args: z.infer<typeof findEscalationsSchema>) => {
      const { escalations, total } = await escalationService.listEscalations({
        status: args.status as any,
        role: args.role,
        type: args.type,
        priority: args.priority,
        limit: args.limit,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: escalations.length,
            escalations: escalations.map((e) => ({
              id: e.id,
              type: e.type,
              subtype: e.subtype,
              role: e.role,
              priority: e.priority,
              status: e.status,
              description: e.description,
              workflow_type: e.workflow_type,
              assigned_to: e.assigned_to,
              created_at: e.created_at,
            })),
          }),
        }],
      };
    },
  );

  // ── get_process_summary ─────────────────────────────────────────
  (instance as any).registerTool(
    'get_process_summary',
    {
      title: 'Get Process Summary',
      description:
        'List business processes grouped by origin_id. Each process shows task count, ' +
        'completed/escalated counts, workflow types involved, and time range.',
      inputSchema: getProcessSummarySchema,
    },
    async (args: z.infer<typeof getProcessSummarySchema>) => {
      const { processes, total } = await taskService.listProcesses({
        workflow_type: args.workflow_type,
        limit: args.limit,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: processes.length,
            processes: processes.map((p) => ({
              origin_id: p.origin_id,
              task_count: p.task_count,
              completed: p.completed,
              escalated: p.escalated,
              workflow_types: p.workflow_types,
              started_at: p.started_at,
              last_activity: p.last_activity,
            })),
          }),
        }],
      };
    },
  );

  // ── get_escalation_stats ────────────────────────────────────────
  (instance as any).registerTool(
    'get_escalation_stats',
    {
      title: 'Get Escalation Stats',
      description:
        'Real-time escalation statistics: pending/claimed counts, created/resolved in last ' +
        '1h and 24h, breakdown by role.',
      inputSchema: getEscalationStatsSchema,
    },
    async (_args: z.infer<typeof getEscalationStatsSchema>) => {
      const stats = await escalationService.getEscalationStats();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(stats),
        }],
      };
    },
  );

  // ── get_workflow_types ──────────────────────────────────────────
  (instance as any).registerTool(
    'get_workflow_types',
    {
      title: 'Get Workflow Types',
      description:
        'List all registered workflow configurations. Shows workflow type, whether it is ' +
        'an LT workflow or container, its task queue, roles, and description.',
      inputSchema: getWorkflowTypesSchema,
    },
    async (_args: z.infer<typeof getWorkflowTypesSchema>) => {
      const configs = await configService.listWorkflowConfigs();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: configs.length,
            workflows: configs.map((c) => ({
              workflow_type: c.workflow_type,
              invocable: c.invocable,
              task_queue: c.task_queue,
              default_role: c.default_role,
              description: c.description,
              roles: c.roles,
            })),
          }),
        }],
      };
    },
  );

  // ── get_system_health ──────────────────────────────────────────
  (instance as any).registerTool(
    'get_system_health',
    {
      title: 'Get System Health',
      description:
        'Overall system health snapshot: task counts by status, escalation counts by status, ' +
        'active workflow types, and recent activity window.',
      inputSchema: getSystemHealthSchema,
    },
    async (_args: z.infer<typeof getSystemHealthSchema>) => {
      const pool = getPool();

      const [taskCounts, escalationCounts, activeTypes, recentActivity] = await Promise.all([
        pool.query(HEALTH_TASK_COUNTS),
        pool.query(HEALTH_ESCALATION_COUNTS),
        pool.query(HEALTH_ACTIVE_WORKFLOW_TYPES),
        pool.query(HEALTH_RECENT_ACTIVITY),
      ]);

      const tasksByStatus: Record<string, number> = {};
      for (const row of taskCounts.rows) {
        tasksByStatus[row.status] = row.count;
      }

      const escalationsByStatus: Record<string, number> = {};
      for (const row of escalationCounts.rows) {
        escalationsByStatus[row.status] = row.count;
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            tasks: tasksByStatus,
            escalations: escalationsByStatus,
            active_workflow_types: activeTypes.rows.map((r: any) => r.workflow_type),
            recent_activity: recentActivity.rows[0],
          }),
        }],
      };
    },
  );

  loggerRegistry.info(`[lt-mcp:db-server] ${name} ready (6 tools registered)`);
  return instance;
}

/**
 * Get the current DB MCP server instance.
 */
export function getDbServer(): McpServer | null {
  return server;
}

/**
 * Stop the DB MCP server and release resources.
 */
export async function stopDbServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:db-server] stopped');
  }
}
