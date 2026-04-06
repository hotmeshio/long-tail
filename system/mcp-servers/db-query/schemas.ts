import { z } from 'zod';

import { QUERY_LIMIT_DEFAULT, QUERY_LIMIT_MAX } from '../../../modules/defaults';

// Schemas extracted to break TS2589 deep-instantiation in registerTool generics

export const findTasksSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'needs_intervention', 'completed', 'failed'])
    .optional().describe('Filter by task status'),
  workflow_type: z.string().optional().describe('Filter by workflow type (e.g. "reviewContent")'),
  workflow_id: z.string().optional().describe('Filter by workflow execution ID'),
  origin_id: z.string().optional().describe('Filter by origin/process ID to see all tasks in a process'),
  limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional().default(QUERY_LIMIT_DEFAULT)
    .describe('Maximum number of results'),
});

export const findEscalationsSchema = z.object({
  status: z.enum(['pending', 'resolved']).optional()
    .describe('Filter by escalation status'),
  role: z.string().optional().describe('Filter by assigned role (e.g. "reviewer", "engineer")'),
  type: z.string().optional().describe('Filter by escalation type'),
  priority: z.number().int().min(1).max(4).optional()
    .describe('Filter by priority (1=critical, 4=low)'),
  limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional().default(QUERY_LIMIT_DEFAULT)
    .describe('Maximum number of results'),
});

export const getProcessSummarySchema = z.object({
  workflow_type: z.string().optional()
    .describe('Filter processes to those containing this workflow type'),
  limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional().default(QUERY_LIMIT_DEFAULT)
    .describe('Maximum number of processes'),
});

export const getEscalationStatsSchema = z.object({});

export const getWorkflowTypesSchema = z.object({});

export const getSystemHealthSchema = z.object({});
