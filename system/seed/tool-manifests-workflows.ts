// ── Workflow and compiler tool manifests ─────────────────────────────────────

export const MCP_WORKFLOW_TOOLS = [
  {
    name: 'list_workflows',
    description: 'List available compiled YAML workflows. These are deterministic pipelines converted from successful MCP triage executions. Each workflow represents a proven solution to a specific edge case. Defaults to listing active (invocable) workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by lifecycle status (default: "active")' },
      },
    },
  },
  {
    name: 'get_workflow',
    description: 'Inspect a compiled workflow by name. Returns the activity manifest, input/output schemas, and provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_name: { type: 'string', description: 'Name of the workflow to inspect' },
      },
      required: ['workflow_name'],
    },
  },
  {
    name: 'invoke_workflow',
    description: 'Run a compiled YAML workflow by name. Deterministic — no LLM reasoning, just direct tool-to-tool data piping. Use list_workflows to discover available workflows and their input schemas. Set async=true for fire-and-forget.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_name: { type: 'string', description: 'Name of the compiled workflow to invoke' },
        input: { type: 'object', description: 'Input data matching the workflow input schema' },
        async: { type: 'boolean', description: 'If true, fire-and-forget (returns job ID)' },
        timeout: { type: 'number', description: 'Max ms to wait for result (sync mode only)' },
      },
      required: ['workflow_name'],
    },
  },
];

export const WORKFLOW_COMPILER_TOOLS = [
  {
    name: 'convert_execution_to_yaml',
    description: 'Analyze a completed workflow execution and convert its tool call sequence into a deterministic HotMesh YAML workflow. Extracts tool call pairs and replaces LLM reasoning with direct tool-to-tool data piping. The generated YAML is stored as a draft that can be deployed and activated.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'The workflow execution ID to analyze' },
        task_queue: { type: 'string', description: 'HotMesh task queue' },
        workflow_name: { type: 'string', description: 'Workflow name' },
        yaml_name: { type: 'string', description: 'Name for the generated YAML workflow' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['workflow_id', 'task_queue', 'workflow_name', 'yaml_name'],
    },
  },
  {
    name: 'deploy_yaml_workflow',
    description: 'Deploy a stored YAML workflow to HotMesh. Optionally activate it immediately and register workers so it can receive invocations.',
    inputSchema: {
      type: 'object',
      properties: {
        yaml_workflow_id: { type: 'string', description: 'UUID of the stored YAML workflow' },
        activate: { type: 'boolean', description: 'Whether to activate immediately after deployment' },
      },
      required: ['yaml_workflow_id'],
    },
  },
  {
    name: 'list_yaml_workflows',
    description: 'List stored YAML workflows with optional status filter.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status (draft, deployed, active, archived)' },
        limit: { type: 'integer', description: 'Maximum results (default: 25)' },
        offset: { type: 'integer', description: 'Pagination offset' },
      },
    },
  },
];

export const CLAUDE_CODE_TOOLS = [
  {
    name: 'execute_task',
    description:
      'Run a task using Claude Code CLI. Claude Code is an agentic coding assistant with terminal access, ' +
      'file I/O, code search, and editing. Returns structured output with result text, cost, and duration.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task prompt. Be specific and actionable.',
          default: 'List the files in the current directory and describe what this project does in 2 sentences.',
        },
        working_directory: {
          type: 'string',
          description: 'Working directory for the task. Defaults to /app (container root).',
          default: '/app',
        },
        allowed_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict which tools Claude Code can use (e.g., ["Read", "Grep", "Glob", "Bash"]).',
          default: ['Read', 'Glob', 'Grep', 'Bash'],
        },
        max_turns: {
          type: 'number',
          description: 'Maximum agentic turns before stopping.',
          default: 5,
        },
        model: {
          type: 'string',
          description: 'Override the Claude model (e.g., "claude-sonnet-4-6").',
          default: 'claude-sonnet-4-6',
        },
        system_prompt: {
          type: 'string',
          description: 'Additional system prompt to append.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Execution timeout in ms. Default: 120000, max: 300000.',
          default: 120000,
        },
        credential_label: {
          type: 'string',
          description: 'Label of the stored Anthropic credential to use (e.g., "subscription", "api-batch").',
          default: 'default',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'check_availability',
    description: 'Check if Claude Code CLI is installed and an API key is available. Returns version and readiness status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
