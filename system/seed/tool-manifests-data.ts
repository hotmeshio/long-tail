// ── Data, storage, HTTP, and OAuth tool manifests ───────────────────────────

export const VISION_TOOLS = [
  {
    name: 'list_document_pages',
    description: 'List available document page images from storage. Returns an array of image references.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'extract_member_info',
    description: 'Extract member information from a document page image using AI Vision. Returns structured MemberInfo or null.',
    inputSchema: {
      type: 'object',
      properties: {
        image_ref: { type: 'string', description: 'Storage reference to the document page image' },
        page_number: { type: 'integer', description: '1-based page number' },
      },
      required: ['image_ref', 'page_number'],
    },
  },
  {
    name: 'validate_member',
    description: 'Validate extracted member information against the member database. Returns match, mismatch, or not_found.',
    inputSchema: {
      type: 'object',
      properties: {
        member_info: { type: 'object', description: 'Extracted member information to validate' },
      },
      required: ['member_info'],
    },
  },
  {
    name: 'rotate_page',
    description: 'Rotate a document page image by the given degrees. Deletes the original by default and returns the new image reference. Use the exact rotated_ref in correctedData.',
    inputSchema: {
      type: 'object',
      properties: {
        image_ref: { type: 'string', description: 'Storage reference to the image to rotate' },
        degrees: { type: 'integer', description: 'Rotation degrees (90, 180, 270)' },
        replace_original: { type: 'boolean', description: 'Delete the original file after rotation (default: true)' },
      },
      required: ['image_ref', 'degrees'],
    },
  },
  {
    name: 'translate_content',
    description: 'Translate content text to the target language. Returns the translated content and detected source language.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content text to translate' },
        target_language: { type: 'string', description: 'Target language code (e.g. "en", "es")' },
      },
      required: ['content', 'target_language'],
    },
  },
];

export const DB_QUERY_TOOLS = [
  { name: 'find_tasks', description: 'Search tasks with optional filters. Returns task records with workflow_id, status, workflow_type, milestones, created/completed timestamps, and metadata.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, workflow_type: { type: 'string' }, workflow_id: { type: 'string' }, origin_id: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'find_escalations', description: 'Search escalations with optional filters. Returns escalation records with type, role, priority, status, description, and assignment info.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, role: { type: 'string' }, type: { type: 'string' }, priority: { type: 'integer' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_process_summary', description: 'List business processes grouped by origin_id. Each process shows task count, completed/escalated counts, workflow types involved, and time range.', inputSchema: { type: 'object', properties: { workflow_type: { type: 'string' }, limit: { type: 'integer', default: 25 } } } },
  { name: 'get_escalation_stats', description: 'Real-time escalation statistics: pending/claimed counts, created/resolved in last 1h and 24h, breakdown by role.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_workflow_types', description: 'List all registered workflow configurations with task queue, roles, invocable flag, and description.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_system_health', description: 'Overall system health snapshot: task counts by status, escalation counts by status, active workflow types, and recent activity window.', inputSchema: { type: 'object', properties: {} } },
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
