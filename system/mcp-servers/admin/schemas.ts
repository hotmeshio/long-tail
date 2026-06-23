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
  limit: z.number().int().min(1).max(100).optional().default(5),
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
  limit: z.number().int().min(1).max(100).optional().default(5),
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
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
  expire: z.string().optional().default('7 days').describe('Retention period (PostgreSQL interval)'),
  jobs: z.boolean().optional().default(true).describe('Hard-delete expired jobs'),
  streams: z.boolean().optional().default(true).describe('Hard-delete expired streams'),
  entities: z.array(z.string()).optional().describe('Entity allowlist'),
  prune_transient: z.boolean().optional().default(false).describe('Delete transient jobs'),
});

// ── agents (routes/agents.ts) ───────────────────────────────────────────────

export const listAgentsSchema = z.object({
  status: z.string().optional().describe('Filter by agent status'),
  knowledge_domain: z.string().optional().describe('Filter by knowledge domain'),
  limit: z.number().int().min(1).max(100).optional().default(5),
  offset: z.number().int().min(0).optional().default(0),
});

export const getAgentSchema = z.object({
  id: z.string().describe('Agent ID'),
});

export const createAgentSchema = z.object({
  id: z.string().describe('Unique agent identifier'),
  description: z.string().optional().describe('Agent description'),
  goals: z.array(z.string()).optional().describe('Agent goals'),
  rules: z.array(z.string()).optional().describe('Agent behavioral rules'),
  status: z.string().optional().describe('Initial status'),
  knowledge_domain: z.string().optional().describe('Knowledge domain'),
  schedules: z.array(z.any()).optional().describe('Cron schedules for the agent'),
  subscriptions: z.array(z.any()).optional().describe('Topic subscriptions for the agent'),
});

export const updateAgentSchema = z.object({
  id: z.string().describe('Agent ID to update'),
  description: z.string().optional().describe('Agent description'),
  goals: z.array(z.string()).optional().describe('Agent goals'),
  rules: z.array(z.string()).optional().describe('Agent behavioral rules'),
  status: z.string().optional().describe('Agent status'),
  knowledge_domain: z.string().optional().describe('Knowledge domain'),
});

export const deleteAgentSchema = z.object({
  id: z.string().describe('Agent ID to delete'),
});

// ── agent subscriptions (routes/agents.ts) ──────────────────────────────────

export const listAgentSubscriptionsSchema = z.object({
  agent_id: z.string().describe('Agent ID to list subscriptions for'),
});

export const createAgentSubscriptionSchema = z.object({
  agent_id: z.string().describe('Agent ID to subscribe'),
  topic: z.string().describe('Topic to subscribe to'),
  reaction_type: z.string().describe('Reaction type (e.g. workflow, pipeline, prompt)'),
  workflow_type: z.string().optional().describe('Workflow type to invoke'),
  pipeline_id: z.string().optional().describe('Pipeline ID to invoke'),
  mcp_prompt: z.string().optional().describe('MCP prompt to execute'),
  input_mapping: z.record(z.any()).optional().describe('Input mapping from event payload'),
  filter: z.record(z.any()).optional().describe('Event filter criteria'),
  execute_as: z.string().optional().describe('Bot external_id to execute as'),
});

export const deleteAgentSubscriptionSchema = z.object({
  id: z.string().describe('Subscription ID to delete'),
});

// ── bot accounts (routes/bot-accounts.ts) ───────────────────────────────────

export const listBotsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const getBotSchema = z.object({
  id: z.string().describe('Bot UUID'),
});

export const createBotSchema = z.object({
  name: z.string().describe('Unique bot name (slug)'),
  description: z.string().optional().describe('Bot description'),
  display_name: z.string().optional().describe('Human-readable display name'),
  roles: z.array(z.object({
    role: z.string(),
    type: z.string(),
  })).optional().describe('Roles to assign on creation'),
});

export const updateBotSchema = z.object({
  id: z.string().describe('Bot UUID'),
  display_name: z.string().optional().describe('Updated display name'),
  description: z.string().optional().describe('Updated description'),
  status: z.string().optional().describe('Bot status'),
});

export const deleteBotSchema = z.object({
  id: z.string().describe('Bot UUID to delete'),
});

export const createBotApiKeySchema = z.object({
  id: z.string().describe('Bot UUID to create key for'),
  name: z.string().describe('Key name/label'),
  scopes: z.array(z.string()).optional().describe('Permission scopes'),
  expires_at: z.string().optional().describe('Expiration timestamp (ISO 8601)'),
});

export const revokeBotKeySchema = z.object({
  key_id: z.string().describe('API key ID to revoke'),
});

// ── control plane (routes/controlplane.ts) ──────────────────────────────────

export const listAppsSchema = z.object({});

export const rollCallSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
  delay: z.number().int().optional().describe('Delay in ms before roll call'),
});

export const applyThrottleSchema = z.object({
  appId: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
  throttle: z.number().int().describe('Throttle value (messages per second)'),
  topic: z.string().optional().describe('Topic to throttle'),
  guid: z.string().optional().describe('Specific GUID to throttle'),
  scope: z.string().optional().describe('Throttle scope'),
});

export const getStreamStatsSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
  duration: z.string().optional().describe('Stats duration window'),
  stream: z.string().optional().describe('Specific stream name'),
});

export const listStreamMessagesSchema = z.object({
  namespace: z.string().optional().default('durable').describe('App namespace (default: durable)'),
  source: z.string().describe('Message source'),
  limit: z.number().int().min(1).max(100).optional().default(5),
  offset: z.number().int().min(0).optional().default(0),
  sort_by: z.string().optional().describe('Sort field'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
  status: z.string().optional().describe('Filter by message status'),
  stream_name: z.string().optional().describe('Filter by stream name'),
  msg_type: z.string().optional().describe('Filter by message type'),
  topic: z.string().optional().describe('Filter by topic'),
  workflow_name: z.string().optional().describe('Filter by workflow name'),
  jid: z.string().optional().describe('Filter by job ID'),
  aid: z.string().optional().describe('Filter by activity ID'),
});

// ── pipelines (routes/pipelines.ts) ─────────────────────────────────────────

export const listPipelineEntitiesSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
});

export const listPipelineJobsSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
  limit: z.number().int().min(1).max(100).optional().default(5),
  offset: z.number().int().min(0).optional().default(0),
  entity: z.string().optional().describe('Filter by entity type'),
  search: z.string().optional().describe('Search term'),
  status: z.string().optional().describe('Filter by job status'),
  sort_by: z.string().optional().describe('Sort field'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
});

export const getJobExecutionSchema = z.object({
  job_id: z.string().describe('Job ID to retrieve'),
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
});

export const interruptJobSchema = z.object({
  job_id: z.string().describe('Job ID to interrupt'),
  topic: z.string().describe('Topic of the job'),
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
});

// ── topics (routes/topics.ts) ───────────────────────────────────────────────

export const listTopicsSchema = z.object({
  category: z.string().optional().describe('Filter by category'),
  search: z.string().optional().describe('Search term'),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const getTopicSchema = z.object({
  topic: z.string().describe('Topic name'),
});

export const createTopicSchema = z.object({
  topic: z.string().describe('Unique topic name'),
  category: z.string().describe('Topic category'),
  description: z.string().optional().describe('Topic description'),
  payload_schema: z.record(z.any()).optional().describe('JSON Schema for event payloads'),
  example_payload: z.record(z.any()).optional().describe('Example payload'),
  tags: z.array(z.string()).optional().describe('Discovery tags'),
});

export const updateTopicSchema = z.object({
  topic: z.string().describe('Topic name to update'),
  description: z.string().optional().describe('Updated description'),
  category: z.string().optional().describe('Updated category'),
  payload_schema: z.record(z.any()).optional().describe('Updated payload schema'),
  example_payload: z.record(z.any()).optional().describe('Updated example payload'),
  tags: z.array(z.string()).optional().describe('Updated tags'),
});

export const deleteTopicSchema = z.object({
  topic: z.string().describe('Topic name to delete'),
});

// ── escalation metadata/bulk (routes/escalations/) ──────────────────────────

export const findByMetadataSchema = z.object({
  key: z.string().describe('Metadata key to search'),
  value: z.string().describe('Metadata value to match'),
  status: z.string().optional().describe('Filter by escalation status'),
  limit: z.number().int().min(1).max(100).optional().default(5),
  offset: z.number().int().min(0).optional().default(0),
});

export const claimByMetadataSchema = z.object({
  key: z.string().describe('Metadata key to match'),
  value: z.string().describe('Metadata value to match'),
  durationMinutes: z.number().int().optional().describe('Lock duration in minutes'),
  assignee: z.string().optional().describe('Assignee user ID'),
  metadata: z.record(z.any()).optional().describe('Additional metadata to attach'),
});

export const resolveByMetadataSchema = z.object({
  key: z.string().describe('Metadata key to match'),
  value: z.string().describe('Metadata value to match'),
  resolverPayload: z.record(z.any()).describe('Resolution payload'),
  assignee: z.string().optional().describe('Assignee user ID'),
  metadata: z.record(z.any()).optional().describe('Additional metadata to attach'),
});

export const bulkClaimSchema = z.object({
  ids: z.array(z.string()).min(1).describe('Escalation UUIDs to claim'),
  durationMinutes: z.number().int().optional().describe('Lock duration in minutes'),
});

export const bulkAssignSchema = z.object({
  ids: z.array(z.string()).min(1).describe('Escalation UUIDs to assign'),
  targetUserId: z.string().describe('User ID to assign to'),
  durationMinutes: z.number().int().optional().describe('Lock duration in minutes'),
});

export const bulkEscalateSchema = z.object({
  ids: z.array(z.string()).min(1).describe('Escalation UUIDs to escalate'),
  targetRole: z.string().describe('Role to escalate to'),
});

export const updatePrioritySchema = z.object({
  ids: z.array(z.string()).min(1).describe('Escalation UUIDs to update'),
  priority: z.number().int().min(1).max(4).describe('New priority (1=critical, 4=low)'),
});

// ── settings (routes/settings.ts) ───────────────────────────────────────────

export const getSettingsSchema = z.object({});

// ── exports (routes/exports.ts) ─────────────────────────────────────────────

export const listExportJobsSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh application namespace (default: durable)'),
  limit: z.number().int().min(1).max(100).optional().default(5),
  offset: z.number().int().min(0).optional().default(0),
  entity: z.string().optional().describe('Filter by entity type'),
  search: z.string().optional().describe('Search term'),
  status: z.string().optional().describe('Filter by export status'),
  sort_by: z.string().optional().describe('Sort field'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
  registered: z.string().optional().describe('Filter by registered status'),
});

export const exportWorkflowStateSchema = z.object({
  workflow_id: z.string().describe('Workflow ID to export'),
  allow: z.array(z.string()).optional().describe('Allowlisted field paths'),
  block: z.array(z.string()).optional().describe('Blocklisted field paths'),
  values: z.record(z.any()).optional().describe('Override values'),
});

export const exportWorkflowExecutionSchema = z.object({
  workflow_id: z.string().describe('Workflow ID to export'),
  excludeSystem: z.boolean().optional().describe('Exclude system activities'),
  omitResults: z.boolean().optional().describe('Omit activity results'),
  mode: z.string().optional().describe('Export mode'),
  maxDepth: z.number().int().optional().describe('Max traversal depth'),
});

export const getExportStatusSchema = z.object({
  workflow_id: z.string().describe('Workflow ID to check export status'),
});

// ── Diagnostics ───────────────────────────────────────────────────────────────

export const diagnoseJobSchema = z.object({
  workflow_id: z.string().describe('Workflow ID to diagnose'),
  app_id: z.string().optional().default('durable').describe('HotMesh namespace / DB schema (default: durable)'),
});

export const findStalledJobsSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh namespace / DB schema (default: durable)'),
  stalled_minutes: z.number().int().min(1).optional().default(5).describe('Minimum minutes since last progress (default: 5)'),
  workflow_type: z.string().optional().describe('Filter by workflow function name'),
  limit: z.number().int().min(1).max(200).optional().default(50).describe('Max results (default: 50)'),
});

export const findOrphanedSignalsSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh namespace / DB schema (default: durable)'),
  limit: z.number().int().min(1).max(500).optional().default(100).describe('Max results (default: 100)'),
});
