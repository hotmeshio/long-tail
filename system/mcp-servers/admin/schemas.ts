/**
 * Zod schemas for the admin MCP server tools.
 *
 * Each schema mirrors the exact parameter shape of the corresponding
 * REST API route handler. When a route accepts `req.query.status`,
 * the schema has `status: z.string().optional()`. When a route
 * reads `req.body.roles`, the schema has `roles: z.array(...)`.
 *
 * Schemas are extracted here (rather than inline) to avoid TS2589
 * deep-instantiation errors in the registerTool() generic.
 */
import { z } from 'zod';

// ── tasks (routes/tasks.ts) ─────────────────────────────────────────────────

export const findTasksSchema = z.object({
  status: z.string().optional().describe('Filter: pending, completed, etc.'),
  workflow_type: z.string().optional().describe('Filter by workflow type name'),
  workflow_id: z.string().optional().describe('Filter by workflow execution ID'),
  origin_id: z.string().optional().describe('Filter by origin/process ID'),
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).optional().default(0),
});

export const getProcessDetailSchema = z.object({
  origin_id: z.string().describe('The origin ID (process ID) to look up'),
});

// ── escalations (routes/escalations/) ───────────────────────────────────────

export const findEscalationsSchema = z.object({
  status: z.enum(['pending', 'resolved']).optional().describe('Filter by status'),
  role: z.string().optional().describe('Filter by target role'),
  type: z.string().optional().describe('Filter by escalation type'),
  priority: z.number().int().min(1).max(4).optional().describe('Filter by priority (1=critical, 4=low)'),
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).optional().default(0),
});

export const getEscalationStatsSchema = z.object({
  period: z.string().optional().describe('Time period: 1h, 24h, 7d, 30d'),
});

export const claimEscalationSchema = z.object({
  id: z.string().describe('Escalation UUID'),
  duration_minutes: z.number().int().optional().default(30)
    .describe('Lock duration in minutes'),
});

export const releaseExpiredClaimsSchema = z.object({});

export const bulkTriageSchema = z.object({
  ids: z.array(z.string()).min(1).describe('Escalation UUIDs to triage'),
  hint: z.string().optional().describe('Remediation hint for the triage agent'),
});

// ── workflow config (routes/workflows/config.ts) ────────────────────────────

export const listWorkflowConfigsSchema = z.object({});

export const upsertWorkflowConfigSchema = z.object({
  workflow_type: z.string().describe('Workflow function name'),
  invocable: z.boolean().optional().default(false),
  task_queue: z.string().nullable().optional().default(null),
  default_role: z.string().optional().default('reviewer'),
  description: z.string().nullable().optional().default(null),
  execute_as: z.string().nullable().optional().default(null)
    .describe('Bot external_id to run as'),
  roles: z.array(z.string()).optional().default([]),
  invocation_roles: z.array(z.string()).optional().default([]),
  consumes: z.array(z.string()).optional().default([]),
  tool_tags: z.array(z.string()).optional().default([]),
  envelope_schema: z.record(z.any()).nullable().optional().default(null),
  resolver_schema: z.record(z.any()).nullable().optional().default(null),
  cron_schedule: z.string().nullable().optional().default(null),
});

export const deleteWorkflowConfigSchema = z.object({
  workflow_type: z.string().describe('Workflow type to de-certify'),
});

// ── workflows (routes/workflows/invocation.ts + discovery.ts) ───────────────

export const listDiscoveredWorkflowsSchema = z.object({
  include_system: z.boolean().optional().default(false),
});

export const invokeWorkflowSchema = z.object({
  workflow_type: z.string().describe('Registered workflow type name'),
  data: z.record(z.any()).describe('Business data for envelope.data'),
  metadata: z.record(z.any()).optional().describe('Control flow metadata'),
  execute_as: z.string().optional().describe('Bot external_id override (admin only)'),
});

export const getWorkflowStatusSchema = z.object({
  workflow_id: z.string().describe('HotMesh workflow ID'),
});

// ── mcp servers (routes/mcp.ts) ─────────────────────────────────────────────

export const listMcpServersSchema = z.object({
  status: z.string().optional().describe('Filter: registered, connected, error, disconnected'),
  tags: z.string().optional().describe('Comma-separated tag filter'),
  search: z.string().optional().describe('Search name, description, or tool names'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const updateMcpServerSchema = z.object({
  id: z.string().describe('Server UUID'),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  auto_connect: z.boolean().optional(),
});

export const connectMcpServerSchema = z.object({
  id: z.string().describe('Server UUID to connect'),
});

export const disconnectMcpServerSchema = z.object({
  id: z.string().describe('Server UUID to disconnect'),
});

// ── yaml workflows (routes/yaml-workflows/) ─────────────────────────────────

export const listYamlWorkflowsSchema = z.object({
  status: z.string().optional().describe('Filter: draft, deployed, active, archived'),
  app_id: z.string().optional().describe('Filter by namespace'),
  search: z.string().optional().describe('Search name, topic, description'),
  source_workflow_id: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const getYamlWorkflowSchema = z.object({
  id: z.string().describe('YAML workflow UUID'),
});

export const createYamlWorkflowSchema = z.object({
  workflow_id: z.string().describe('Source execution workflow ID'),
  task_queue: z.string().describe('Task queue of the source execution'),
  workflow_name: z.string().describe('Source workflow type name'),
  name: z.string().describe('Name for the new compiled workflow'),
  description: z.string().optional(),
  app_id: z.string().optional().describe('Namespace (auto-generated if omitted)'),
  tags: z.array(z.string()).optional().describe('Discovery tags'),
  compilation_feedback: z.string().optional().describe('Extra instructions for the compiler'),
});

export const deployYamlWorkflowSchema = z.object({
  id: z.string().describe('YAML workflow UUID to deploy'),
});

export const invokeYamlWorkflowSchema = z.object({
  id: z.string().describe('YAML workflow UUID'),
  data: z.record(z.any()).optional().default({}).describe('Input matching the workflow input_schema'),
  sync: z.boolean().optional().default(false).describe('Wait for result'),
  timeout: z.number().int().optional().describe('Timeout in ms for sync mode'),
});

// ── users (routes/users.ts) ─────────────────────────────────────────────────

export const listUsersSchema = z.object({
  role: z.string().optional().describe('Filter by role name'),
  status: z.string().optional().describe('Filter: active, inactive, suspended'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const createUserSchema = z.object({
  external_id: z.string().describe('Stable user identifier'),
  display_name: z.string().optional(),
  email: z.string().optional(),
  roles: z.array(z.object({
    role: z.string(),
    type: z.enum(['superadmin', 'admin', 'member']),
  })).optional().default([]).describe('Roles to assign on creation'),
});

export const addUserRoleSchema = z.object({
  user_id: z.string().describe('User UUID'),
  role: z.string().describe('Role name'),
  type: z.enum(['superadmin', 'admin', 'member']).describe('Permission level'),
});

export const removeUserRoleSchema = z.object({
  user_id: z.string().describe('User UUID'),
  role: z.string().describe('Role to remove'),
});

// ── roles (routes/roles.ts) ─────────────────────────────────────────────────

export const listRolesSchema = z.object({});

export const createRoleSchema = z.object({
  role: z.string().describe('Lowercase alphanumeric role name (a-z, 0-9, hyphens, underscores)'),
});

export const addEscalationChainSchema = z.object({
  source_role: z.string().describe('Originating role'),
  target_role: z.string().describe('Destination role for escalation'),
});

// ── maintenance (routes/dba.ts) ─────────────────────────────────────────────

export const pruneSchema = z.object({
  expire: z.string().optional().default('7 days').describe('Retention period (PostgreSQL interval)'),
  jobs: z.boolean().optional().default(true).describe('Hard-delete expired jobs'),
  streams: z.boolean().optional().default(true).describe('Hard-delete expired streams'),
  entities: z.array(z.string()).optional().describe('Entity allowlist'),
  prune_transient: z.boolean().optional().default(false).describe('Delete transient jobs'),
});
