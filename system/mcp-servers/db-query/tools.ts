import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getPool } from '../../../services/db';
import * as taskService from '../../../services/task';
import * as escalationService from '../../../services/escalation';
import * as configService from '../../../services/config';
import {
  HEALTH_TASK_COUNTS,
  HEALTH_ESCALATION_COUNTS,
  HEALTH_ACTIVE_WORKFLOW_TYPES,
  HEALTH_RECENT_ACTIVITY,
} from '../../../services/mcp/sql';

import {
  findTasksSchema,
  findEscalationsSchema,
  getProcessSummarySchema,
  getEscalationStatsSchema,
  getWorkflowTypesSchema,
  getSystemHealthSchema,
} from './schemas';

/**
 * Register all six read-only query tools on the given MCP server instance.
 */
export function registerTools(instance: McpServer): void {
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
}
