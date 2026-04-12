// ── Data, storage, HTTP, and OAuth tool manifests ───────────────────────────

export const TRANSLATION_TOOLS = [
  {
    name: 'translate_content',
    description: 'Translate content text to the target language. Returns the translated content and detected source language.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content text to translate' },
        target_language: { type: 'string', description: 'Target language code (e.g. "en", "es")' },
        source_language: { type: 'string', description: 'Source language code (auto-detected if omitted)' },
      },
      required: ['content', 'target_language'],
    },
  },
];

export const VISION_ANALYSIS_TOOLS = [
  {
    name: 'analyze_image',
    description: 'Analyze an image and extract structured data: description, text content, and notable objects.',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Image URL or data URI' },
        prompt: { type: 'string', description: 'Optional analysis prompt to guide the model' },
      },
      required: ['image'],
    },
  },
  {
    name: 'describe_image',
    description: 'Generate a detailed description of an image.',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Image URL or data URI' },
        context: { type: 'string', description: 'Optional context about the image' },
      },
      required: ['image'],
    },
  },
];

export const DB_QUERY_TOOLS = [
  { name: 'find_tasks', description: 'Search tasks with optional filters. Returns task records with workflow_id, status, workflow_type, milestones, created/completed timestamps, and metadata.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, workflow_type: { type: 'string' }, workflow_id: { type: 'string' }, origin_id: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'find_escalations', description: 'Search escalations with optional filters. Returns escalation records with type, role, priority, status, description, and assignment info.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, role: { type: 'string' }, type: { type: 'string' }, priority: { type: 'integer' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_process_summary', description: 'List business processes grouped by origin_id. Each process shows task count, completed/escalated counts, workflow types involved, and time range.', inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_escalation_stats', description: 'Real-time escalation statistics: pending/claimed counts, created/resolved in last 1h and 24h, breakdown by role.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_workflow_types', description: 'List all registered workflow configurations with task queue, roles, invocable flag, and description.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_system_health', description: 'Full system overview: durable workflow execution counts by type (active/completed), task counts by status, escalation counts by status, recent activity window, MCP servers (with tool counts and tags), compiled workflow totals, and workflow configurations.', inputSchema: { type: 'object', properties: {} } },
];

export const FILE_STORAGE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read file content from managed storage. Returns content, size, and detected MIME type. Supports utf8 (text) or base64 encoding.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file in managed storage' },
        encoding: { type: 'string', description: 'Encoding to use (utf8 or base64)', default: 'utf8' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in managed storage. Creates directories as needed. Returns the storage reference and size.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path for the file in managed storage' },
        content: { type: 'string', description: 'File content to write' },
        encoding: { type: 'string', description: 'Encoding of the content (utf8 or base64)', default: 'utf8' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a storage directory. Returns file paths, sizes, and modification timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory path to list (default: root)', default: '/' },
        recursive: { type: 'boolean', description: 'Whether to list recursively', default: false },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Remove a file from managed storage.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file to delete' },
      },
      required: ['path'],
    },
  },
];

export const HTTP_FETCH_TOOLS = [
  {
    name: 'http_request',
    description: 'Make an HTTP request to any URL. Supports all methods, custom headers, and request bodies. Returns status, headers, and body.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to request' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body' },
        timeout_ms: { type: 'number', description: 'Request timeout in milliseconds' },
      },
      required: ['url'],
    },
  },
  {
    name: 'fetch_json',
    description: 'GET a URL and parse the response as JSON. Convenience wrapper around http_request.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch JSON from' },
        headers: { type: 'object', description: 'Request headers' },
      },
      required: ['url'],
    },
  },
  {
    name: 'fetch_text',
    description: 'GET a URL and return the response as text. Returns content, status, and content type.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch text from' },
        headers: { type: 'object', description: 'Request headers' },
      },
      required: ['url'],
    },
  },
];

export const OAUTH_TOOLS = [
  {
    name: 'get_access_token',
    description: 'Get a fresh OAuth access token for an external service. Automatically refreshes expired tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'OAuth provider name (google, github, microsoft, anthropic, etc.)' },
        user_id: { type: 'string', description: 'User ID to get token for' },
        label: { type: 'string', description: 'Credential label (default: "default"). Select among multiple credentials for the same provider.' },
      },
      required: ['provider', 'user_id'],
    },
  },
  {
    name: 'list_connections',
    description: 'List all OAuth providers connected for a user. Returns provider, label, and credential type for each connection.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User ID to list connections for' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'revoke_connection',
    description: 'Disconnect an OAuth provider for a user, removing stored tokens. Use label to target a specific credential.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'OAuth provider name to disconnect' },
        user_id: { type: 'string', description: 'User ID to revoke connection for' },
        label: { type: 'string', description: 'Credential label to revoke (default: "default")' },
      },
      required: ['provider', 'user_id'],
    },
  },
];
