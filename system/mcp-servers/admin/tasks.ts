/**
 * Task query tools — mirrors routes/tasks.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as taskService from '../../../services/task';
import * as escalationService from '../../../services/escalation';
import { findTasksSchema, getProcessDetailSchema } from './schemas';

export function registerTaskTools(server: McpServer): void {

  (server as any).registerTool(
    'find_tasks',
    {
      title: 'Find Tasks',
      description:
        'Search tasks with optional filters. Returns task records with ' +
        'workflow_id, status, workflow_type, and timestamps.',
      inputSchema: findTasksSchema,
    },
    async (args: z.infer<typeof findTasksSchema>) => {
      const { tasks, total } = await taskService.listTasks({
        status: args.status as any,
        workflow_type: args.workflow_type,
        workflow_id: args.workflow_id,
        origin_id: args.origin_id,
        limit: args.limit,
        offset: args.offset,
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
            })),
          }),
        }],
      };
    },
  );

  (server as any).registerTool(
    'get_process_detail',
    {
      title: 'Get Process Detail',
      description:
        'Get all tasks and escalations for a process (origin_id). ' +
        'Returns the full history of a multi-step workflow execution.',
      inputSchema: getProcessDetailSchema,
    },
    async (args: z.infer<typeof getProcessDetailSchema>) => {
      const [tasks, escalations] = await Promise.all([
        taskService.getProcessTasks(args.origin_id),
        escalationService.getEscalationsByOriginId(args.origin_id),
      ]);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            origin_id: args.origin_id,
            task_count: tasks.length,
            escalation_count: escalations.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              workflow_id: t.workflow_id,
              workflow_type: t.workflow_type,
              status: t.status,
              created_at: t.created_at,
              completed_at: t.completed_at,
            })),
            escalations: escalations.map((e) => ({
              id: e.id,
              type: e.type,
              role: e.role,
              status: e.status,
              created_at: e.created_at,
            })),
          }),
        }],
      };
    },
  );
}
