// ── Admin tool manifests ─────────────────────────────────────────────────────
// Each entry mirrors the exact tool registered in system/mcp-servers/admin/

export const ADMIN_TOOLS = [
  // ── tasks.ts ────────────────────────────────────────────────────────────
  { name: 'find_tasks', description: 'Search tasks with optional filters. Returns task records with workflow_id, status, workflow_type, and timestamps.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, workflow_type: { type: 'string' }, workflow_id: { type: 'string' }, origin_id: { type: 'string' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } },
  { name: 'get_process_detail', description: 'Get all tasks and escalations for a process (origin_id).', inputSchema: { type: 'object', properties: { origin_id: { type: 'string' } }, required: ['origin_id'] } },

  // ── escalations.ts ──────────────────────────────────────────────────────
  { name: 'find_escalations', description: 'Search escalations with optional filters by status, role, type, priority.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'resolved'] }, role: { type: 'string' }, type: { type: 'string' }, priority: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } },
  { name: 'get_escalation_stats', description: 'Aggregated escalation statistics: pending, claimed, created, resolved counts with breakdown by role.', inputSchema: { type: 'object', properties: { period: { type: 'string' } } } },
  { name: 'claim_escalation', description: 'Claim an escalation for a time-boxed lock.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, duration_minutes: { type: 'integer' } }, required: ['id'] } },
  { name: 'release_expired_claims', description: 'Release all escalation claims that exceeded their lock duration.', inputSchema: { type: 'object', properties: {} } },
  { name: 'bulk_triage', description: 'Resolve escalations for triage and start mcpTriage workflows.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, hint: { type: 'string' } }, required: ['ids'] } },

  // ── workflow-config.ts ──────────────────────────────────────────────────
  { name: 'list_workflow_configs', description: 'List all certified workflow configurations with roles and settings.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upsert_workflow_config', description: 'Create or replace a workflow configuration (certify). Activates the interceptor for task tracking and escalation chains.', inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' }, invocable: { type: 'boolean' }, task_queue: { type: 'string' }, default_role: { type: 'string' }, description: { type: 'string' }, execute_as: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } }, invocation_roles: { type: 'array', items: { type: 'string' } }, consumes: { type: 'array', items: { type: 'string' } }, tool_tags: { type: 'array', items: { type: 'string' } }, cron_schedule: { type: 'string' } }, required: ['workflow_type'] } },
  { name: 'delete_workflow_config', description: 'De-certify a workflow by removing its config entry.', inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' } }, required: ['workflow_type'] } },

  // ── workflows.ts ────────────────────────────────────────────────────────
  { name: 'list_discovered_workflows', description: 'Unified list of all known workflows: active workers, historical entities, and registered configs.', inputSchema: { type: 'object', properties: { include_system: { type: 'boolean' } } } },
  { name: 'invoke_workflow', description: 'Start a certified workflow by type. Returns workflow ID immediately.', inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' }, data: { type: 'object' }, metadata: { type: 'object' }, execute_as: { type: 'string' } }, required: ['workflow_type', 'data'] } },
  { name: 'get_workflow_status', description: 'Check workflow status and result. Returns status (0=complete, positive=running) and result if complete.', inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' } }, required: ['workflow_id'] } },

  // ── mcp-servers.ts ──────────────────────────────────────────────────────
  { name: 'list_mcp_servers', description: 'List registered MCP servers with optional filters by status, tags, or search.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, tags: { type: 'string' }, search: { type: 'string' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } },
  { name: 'update_mcp_server', description: 'Update an MCP server registration (tags, description, auto_connect).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, auto_connect: { type: 'boolean' } }, required: ['id'] } },
  { name: 'connect_mcp_server', description: 'Connect to a registered MCP server.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'disconnect_mcp_server', description: 'Disconnect from an MCP server.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },

  // ── yaml-workflows.ts ───────────────────────────────────────────────────
  { name: 'list_yaml_workflows', description: 'List compiled YAML workflows with optional status, namespace, or search filter.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, app_id: { type: 'string' }, search: { type: 'string' }, source_workflow_id: { type: 'string' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } },
  { name: 'get_yaml_workflow', description: 'Inspect a compiled workflow by ID. Returns activity manifest, schemas, and YAML content.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_yaml_workflow', description: 'Compile a completed execution into a deterministic YAML workflow. Stored as a draft.', inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' }, task_queue: { type: 'string' }, workflow_name: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, app_id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, compilation_feedback: { type: 'string' } }, required: ['workflow_id', 'task_queue', 'workflow_name', 'name'] } },
  { name: 'deploy_yaml_workflow', description: 'Deploy a compiled YAML workflow, activate it, and register workers.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'invoke_yaml_workflow', description: 'Run a compiled YAML workflow. Deterministic — no LLM. Set sync=true to wait.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, data: { type: 'object' }, sync: { type: 'boolean' }, timeout: { type: 'integer' } }, required: ['id'] } },

  // ── users.ts (users + roles) ────────────────────────────────────────────
  { name: 'list_users', description: 'List user accounts with optional role and status filters.', inputSchema: { type: 'object', properties: { role: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } },
  { name: 'create_user', description: 'Create a new user account with optional roles.', inputSchema: { type: 'object', properties: { external_id: { type: 'string' }, display_name: { type: 'string' }, email: { type: 'string' }, roles: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, type: { type: 'string', enum: ['superadmin', 'admin', 'member'] } }, required: ['role', 'type'] } } }, required: ['external_id'] } },
  { name: 'add_user_role', description: 'Assign a role to a user.', inputSchema: { type: 'object', properties: { user_id: { type: 'string' }, role: { type: 'string' }, type: { type: 'string', enum: ['superadmin', 'admin', 'member'] } }, required: ['user_id', 'role', 'type'] } },
  { name: 'remove_user_role', description: 'Remove a role from a user.', inputSchema: { type: 'object', properties: { user_id: { type: 'string' }, role: { type: 'string' } }, required: ['user_id', 'role'] } },
  { name: 'list_roles', description: 'List all distinct roles known to the system.', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_role', description: 'Create a new role. Lowercase alphanumeric with hyphens/underscores.', inputSchema: { type: 'object', properties: { role: { type: 'string' } }, required: ['role'] } },
  { name: 'add_escalation_chain', description: 'Define an escalation path from one role to another.', inputSchema: { type: 'object', properties: { source_role: { type: 'string' }, target_role: { type: 'string' } }, required: ['source_role', 'target_role'] } },

  // ── maintenance.ts ──────────────────────────────────────────────────────
  { name: 'prune', description: 'Prune expired jobs, streams, and execution artifacts from the database.', inputSchema: { type: 'object', properties: { expire: { type: 'string' }, jobs: { type: 'boolean' }, streams: { type: 'boolean' }, entities: { type: 'array', items: { type: 'string' } }, prune_transient: { type: 'boolean' } } } },
];
