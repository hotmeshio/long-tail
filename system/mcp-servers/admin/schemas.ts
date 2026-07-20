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

import { FACET_KEY } from '../../../services/escalation/facet-sql';

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
  status: z.enum(['pending', 'resolved', 'cancelled', 'expired']).optional().describe('Filter by status'),
  role: z.string().optional().describe('Filter by target role'),
  type: z.string().optional().describe('Filter by escalation type'),
  subtype: z.string().optional().describe('Filter by escalation subtype'),
  assigned_to: z.string().optional().describe('Filter by assigned user UUID (active claim holder)'),
  search: z.string().optional().describe('Exact-match lookup by correlation id — the escalation id, its workflow id, or origin id (order/ticket). Index-served, server-side over the full result set. To match a value INSIDE metadata (e.g. an order id), use `facets` instead.'),
  priority: z.number().int().min(1).max(4).optional().describe('Filter by priority (1=critical, 4=low)'),
  sort_by: z.enum(['created_at', 'priority', 'updated_at']).optional().describe('Sort column (default: priority asc, then created_at asc)'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort direction for sort_by'),
  limit: z.number().int().min(1).max(100).optional().default(5),
  offset: z.number().int().min(0).optional().default(0),
  // Faceted metadata query (role-scoped in SQL). A "facet" is a key/value INSIDE the
  // row's metadata JSONB, matched by containment (metadata @>), GIN-served.
  roles: z.array(z.string()).optional().describe('Restrict to these roles (role = ANY); narrows within scope, never widens past it'),
  facets: z.record(z.any()).optional().describe('Required metadata facets — metadata @> facets (AND). e.g. { filament: "pla" } means metadata.filament == "pla"'),
  block: z.array(z.record(z.any())).optional().describe('Exclude rows whose metadata contains ANY of these facet sets: NOT (metadata @> ANY(block))'),
  range: z.array(z.object({
    facet: z.string(),
    op: z.enum(['<', '<=', '>', '>=', '=']),
    value: z.number(),
  })).optional().describe('Numeric ranges over a metadata facet, e.g. { facet: "confidence", op: "<=", value: 0.7 }'),
  exists: z.array(z.string()).optional().describe('Metadata keys that must be present: metadata ? key'),
  available: z.boolean().optional().describe('true = only unclaimed/expired; false = only held now'),
  orderBy: z.array(z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc']).optional(),
    numeric: z.boolean().optional(),
  })).optional().describe('Sort by a column or a metadata path written "metadata.<key>" (set numeric for numeric sort)'),
});

export const getEscalationSchema = z.object({
  id: z.string().describe('Escalation UUID'),
});

export const getEscalationsByWorkflowSchema = z.object({
  workflow_id: z.string().describe('HotMesh workflow ID to list escalations for'),
});

export const getEscalationStatsSchema = z.object({
  period: z.string().optional().describe('Time period: 1h, 24h, 7d, 30d'),
});

export const claimEscalationSchema = z.object({
  id: z.string().describe('Escalation UUID'),
  duration_minutes: z.number().int().optional().default(30)
    .describe('Lock duration in minutes'),
});

export const releaseEscalationSchema = z.object({
  id: z.string().describe('Escalation UUID to release back to the pool'),
});

export const resolveEscalationSchema = z.object({
  id: z.string().describe('Escalation UUID to resolve'),
  resolverPayload: z.record(z.any()).describe('Resolution payload (matches the escalation form/resolver schema)'),
});

export const resolveBySignalKeySchema = z.object({
  signalKey: z.string().describe('Deterministic signal_key of an efficient escalation'),
  resolverPayload: z.record(z.any()).describe('Resolution payload'),
});

export const escalateEscalationSchema = z.object({
  id: z.string().describe('Escalation UUID'),
  targetRole: z.string().describe('Role to route the escalation to'),
});

export const cancelEscalationSchema = z.object({
  id: z.string().describe('Escalation UUID to cancel'),
});

export const bulkCancelSchema = z.object({
  ids: z.array(z.string()).min(1).describe('Escalation UUIDs to cancel'),
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
  certified: z.boolean().optional()
    .describe('Explicit HITL certification (interceptor treatment). Omitted → derived from roles/consumes presence.'),
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
  resolver_schema: z.record(z.any()).nullable().optional()
    .describe('DEPRECATED: the escalation form is a versioned schema owned by the target role. Legacy fallback only.')
    .default(null),
  cron_schedule: z.string().nullable().optional().default(null),
});

export const deleteWorkflowConfigSchema = z.object({
  workflow_type: z.string().describe('Workflow type to unregister (deletes the registration row)'),
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
  app_id: z.string().optional().describe('HotMesh namespace for resolution (default: durable). Set this to read a child/workflow running in another app.'),
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

// Work-surface scope for a `member` grant. read governs search breadth, write
// governs claim/ack/delete breadth; admin/superadmin ignore scope (act on all).
// The write ⊆ read constraint (write_scope='all' requires read_scope='all') is
// validated in the handler so these stay plain object shapes for the tool registry.
const scopeFields = {
  read_scope: z.enum(['self', 'all']).optional()
    .describe("Member search breadth: 'self' (own items) or 'all' (whole queue). Default all"),
  write_scope: z.enum(['none', 'self', 'all']).optional()
    .describe("Member claim/ack/delete breadth: 'none', 'self' (own items), or 'all'. Default all"),
};

export const createUserSchema = z.object({
  external_id: z.string().describe('Stable user identifier'),
  display_name: z.string().optional(),
  email: z.string().optional(),
  roles: z.array(z.object({
    role: z.string(),
    type: z.enum(['superadmin', 'admin', 'member']),
    ...scopeFields,
  })).optional().default([]).describe('Roles to assign on creation (each with optional work-surface scope)'),
});

export const addUserRoleSchema = z.object({
  user_id: z.string().describe('User UUID'),
  role: z.string().describe('Role name'),
  type: z.enum(['superadmin', 'admin', 'member']).describe('Permission level'),
  ...scopeFields,
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

export const updateRoleSchema = z.object({
  role: z.string().describe('Role key to update'),
  title: z.string().nullable().optional().describe('Display name shown on role cards and station views'),
  description: z.string().nullable().optional().describe('Short description of this role\'s purpose'),
  form_schema: z.record(z.any()).nullable().optional().describe('JSON Schema for the escalation resolve form (the JIT UI). Versioned per role; fields may carry x-lt-bind to map to the payload. Takes precedence over the deprecated workflow-level resolver_schema.'),
  metadata_schema: z.record(z.any()).nullable().optional().describe('JSON Schema declaring the expected shape of lt_escalations.metadata for this role. Drives creation-time validation and faceted-query key autocomplete.'),
  properties: z.record(z.any()).nullable().optional().describe('Free user-owned bag (icon, color, tags, etc.). No reserved keys — use the typed columns below for operational values.'),
  ops_visible: z.boolean().optional().describe('When true, role appears as a station on the /operations view'),
  parent_role: z.string().nullable().optional().describe('Parent role in the process dependency graph (nullable; roots have no parent)'),
  sla_minutes: z.number().nullable().optional().describe('Target resolution time in minutes. One of the capacity settings: target_per_hour = worker_count / (sla_minutes / 60)'),
  target_per_hour: z.number().nullable().optional().describe('Intended throughput (items resolved per hour). Drives the station pace baseline on the Operations view.'),
  worker_count: z.number().nullable().optional().describe('Capacity at this station (staff or machine count). One of the capacity settings.'),
  priority_threshold_minutes: z.number().min(0).nullable().optional().describe('Max age in minutes before a pending unclaimed escalation counts toward the Pace Board priority count. Falls back to sla_minutes when null.'),
  priority_facet: z.string().regex(FACET_KEY).nullable().optional().describe('lt_escalations.metadata key holding the age origin for the priority count as an ISO 8601 UTC timestamp (e.g. authorized_at). Falls back to created_at when null. When set, items missing the key or holding an unparseable value are not counted.'),
  upstream_roles: z.array(z.string()).nullable().optional().describe('Replace the set of roles this station draws input from across other sequences (parent_role stays the single prior step in its own sequence). Omitted = preserve; null or [] = clear.'),
  list_schema: z.record(z.any()).nullable().optional().describe('JSON contract (x-lt-* markup) that richly formats this role\'s escalation LIST page. Versioned independently of form_schema; the list always renders the latest version.'),
  default_pins: z.array(z.object({
    label: z.string().describe('Pin label shown in the member\'s Pinned nav section'),
    url: z.string().describe('Dashboard-relative deep link (must start with /)'),
    badge: z.boolean().optional().describe('Render a live count beside the label (escalations-list URLs)'),
  })).nullable().optional().describe('Pinned-view seeds handed to every member of this role. Members promote, hide, or reorder them via their own preferences. Null clears.'),
  change_summary: z.string().optional().describe('Recorded on the schema version snapshot when this update changes form_schema or metadata_schema'),
});

export const getRoleSchemaSchema = z.object({
  role: z.string().describe('Role whose schema to fetch'),
  version: z.number().int().min(1).optional().describe('Version pin — returns that immutable snapshot. Omit for the live (latest) schema.'),
});

export const listRoleSchemaVersionsSchema = z.object({
  role: z.string().describe('Role whose schema version history to list'),
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
  max_events: z.number().int().min(1).optional().default(500).describe('Cap on execution events returned when events are included; most recent are kept (default: 500).'),
  include: z.array(z.enum(['events', 'streams'])).optional().describe('Heavy sections to add to the verdict. "events" adds the execution timeline; "streams" adds raw engine+worker messages. Omit for the compact verdict (status, idle, stream counts, escalation, findings). For full raw message payloads prefer list_stream_messages filtered by jid.'),
  verbosity: z.enum(['summary', 'full']).optional().describe('Shorthand: "summary" (default) = verdict only; "full" = events + streams. Overridden by an explicit include[].'),
});

export const findStalledJobsSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh namespace / DB schema (default: durable)'),
  idle_minutes: z.number().int().min(1).optional().default(5).describe('Minimum minutes since last status change (default: 5). NOTE: a frozen updated_at is NORMAL for a workflow waiting at a condition — see each row\'s `likely` classification.'),
  workflow_type: z.string().optional().describe('Filter by workflow function name'),
  limit: z.number().int().min(1).max(200).optional().default(50).describe('Max results (default: 50, max: 200)'),
});

export const findOrphanedSignalsSchema = z.object({
  app_id: z.string().optional().default('durable').describe('HotMesh namespace / DB schema (default: durable)'),
  within_hours: z.number().int().min(1).max(720).optional().default(24).describe('Recent time window to scan, in hours (default: 24, max: 720). Bounds the scan of the partitioned worker_streams table — widen deliberately to reach older orphans.'),
  limit: z.number().int().min(1).max(500).optional().default(100).describe('Max results (default: 100, max: 500)'),
});

// ── Faceted routing + set resolve ───────────────────────────────────────────

/** A faceted query over a pond — filter/sort by columns and metadata facets. */
export const facetQuerySchema = z.object({
  role: z.string().describe('Pond role to target (the escalation role)'),
  status: z.string().optional().describe("Status filter (e.g. 'pending')"),
  available: z.boolean().optional().describe('Only rows not currently claimed'),
  facets: z.record(z.any()).optional().describe('Metadata facet equality filters'),
  orderBy: z.array(z.object({
    column: z.string(),
    direction: z.enum(['asc', 'desc']),
  })).optional().describe('Sort order over columns'),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
});

export const resolveByIdsSchema = z.object({
  ids: z.array(z.string()).min(1).describe('Escalation ids to resolve as one set'),
  resolverPayload: z.record(z.any()).describe('Resolution payload applied to every row'),
  metadata: z.record(z.any()).optional().describe('Outcome patch merged into each row'),
});

export const searchByFacetsSchema = facetQuerySchema;

export const claimGroupsSchema = z.object({
  query: facetQuerySchema,
  limit: z.number().int().min(1).optional().describe('Max groups to claim'),
  durationMinutes: z.number().int().min(1).optional().describe('Claim TTL in minutes'),
  sizeFacet: z.string().optional().describe('Metadata key holding the group size'),
});

export const claimByFacetsSchema = z.object({
  query: facetQuerySchema,
  limit: z.number().int().min(1).optional().describe('Max rows to claim'),
  durationMinutes: z.number().int().min(1).optional().describe('Claim TTL in minutes'),
  allOrNone: z.boolean().optional().describe('Commit only if the full limit was acquired'),
});
