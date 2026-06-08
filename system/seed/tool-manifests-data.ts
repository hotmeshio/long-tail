// ── Data, storage, HTTP, and OAuth tool manifests ───────────────────────────

export const TRANSLATION_TOOLS = [
  {
    name: 'translate_content',
    description: 'Translate content text to the target language. Returns the translated content and detected source language.',
    read_safe: true,
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
    description: 'Analyze an image and extract structured data: description, text content, and notable objects. Accepts storage paths directly (e.g., "google_homepage.png" from capture_page) — no need to read_file first.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Image source: a storage path (e.g., "screenshot.png" from capture_page), a data URI, or an https:// URL. Storage paths are read automatically.' },
        prompt: { type: 'string', description: 'Optional analysis prompt to guide the model' },
      },
      required: ['image'],
    },
  },
  {
    name: 'describe_image',
    description: 'Generate a detailed description of an image. Accepts storage paths directly (e.g., "screenshot.png" from capture_page) — no need to read_file first.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Image source: a storage path (e.g., "screenshot.png" from capture_page), a data URI, or an https:// URL. Storage paths are read automatically.' },
        context: { type: 'string', description: 'Optional context about the image' },
      },
      required: ['image'],
    },
  },
];

export const DB_QUERY_TOOLS = [
  { name: 'find_tasks', description: 'Search tasks with optional filters. Returns task records with workflow_id, status, workflow_type, milestones, created/completed timestamps, and metadata.', read_safe: true, inputSchema: { type: 'object', properties: { status: { type: 'string' }, workflow_type: { type: 'string' }, workflow_id: { type: 'string' }, origin_id: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'find_escalations', description: 'Search escalations with optional filters. Returns escalation records with type, role, priority, status, description, and assignment info.', read_safe: true, inputSchema: { type: 'object', properties: { status: { type: 'string' }, role: { type: 'string' }, type: { type: 'string' }, priority: { type: 'integer' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_process_summary', description: 'List business processes grouped by origin_id. Each process shows task count, completed/escalated counts, workflow types involved, and time range.', read_safe: true, inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_escalation_stats', description: 'Real-time escalation statistics: pending/claimed counts, created/resolved in last 1h and 24h, breakdown by role.', read_safe: true, inputSchema: { type: 'object', properties: {} } },
  { name: 'get_workflow_types', description: 'List all registered workflow configurations with task queue, roles, invocable flag, and description.', read_safe: true, inputSchema: { type: 'object', properties: {} } },
  { name: 'get_system_health', description: 'Full system overview: durable workflow execution counts by type (active/completed), task counts by status, escalation counts by status, recent activity window, MCP servers (with tool counts and tags), compiled workflow totals, and workflow configurations.', read_safe: true, inputSchema: { type: 'object', properties: {} } },
];

export const FILE_STORAGE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read file content from managed storage. Returns content, size, and detected MIME type. Supports utf8 (text) or base64 encoding.',
    read_safe: true,
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
    read_safe: false,
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
    read_safe: true,
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
    read_safe: false,
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
    read_safe: false,
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
    read_safe: true,
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
    read_safe: true,
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

export const SCHEMA_EXCHANGE_TOOLS = [
  {
    name: 'exchange',
    description: 'Exchange data with an external service endpoint under schema enforcement. Validates request body against request_schema before sending and response body against response_schema after receiving. Transport is hidden — the principle is endpoint + schema + validated exchange.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', description: 'Service endpoint URL' },
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE, PATCH' },
        headers: { type: 'object', description: 'Request headers' },
        query: { type: 'object', description: 'Query parameters' },
        body: { description: 'Request body (validated against request_schema if provided)' },
        request_schema: { type: 'object', description: 'JSON Schema for request body validation' },
        response_schema: { type: 'object', description: 'JSON Schema for response body validation' },
        timeout_ms: { type: 'number', description: 'Request timeout in milliseconds' },
        credential_provider: { type: 'string', description: 'Credential provider name — resolves auth from the connection store automatically' },
        credential_label: { type: 'string', description: 'Credential label for multi-credential accounts' },
        auth_scheme: { type: 'string', description: 'Auth scheme (default: Bearer)' },
        auth_header: { type: 'string', description: 'Header name for credential (default: Authorization)' },
      },
      required: ['endpoint', 'method'],
    },
  },
  {
    name: 'validate_schema',
    description: 'Validate any value against a JSON Schema without making a network call. Useful for pre-validation, testing, and transform verification.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'The value to validate' },
        schema: { type: 'object', description: 'JSON Schema to validate against' },
      },
      required: ['data', 'schema'],
    },
  },
];

export const DOCS_TOOLS = [
  {
    name: 'list_docs',
    description: 'List all available documentation files with their titles.',
    read_safe: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_docs',
    description: 'Search across all documentation for a keyword or phrase. Returns matching files with line context.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or phrase to find in documentation' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_doc',
    description: 'Read the full content of a documentation file.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Document path relative to docs/ (e.g. "mcp.md" or "api/tasks.md")' },
      },
      required: ['path'],
    },
  },
];

export const OAUTH_TOOLS = [
  {
    name: 'get_access_token',
    description: 'Get a fresh OAuth access token for an external service. Automatically refreshes expired tokens.',
    read_safe: true,
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
    read_safe: true,
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
    read_safe: false,
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
