// ── Knowledge store tool manifests ───────────────────────────────────────────

export const KNOWLEDGE_TOOLS = [
  {
    name: 'store_knowledge',
    description: 'Store or update a knowledge entry. Upserts by domain+key: merges data and unions tags if the entry already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Knowledge domain (namespace)' },
        key: { type: 'string', description: 'Unique key within domain' },
        data: { type: 'object', description: 'JSONB payload to store' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Categorization tags' },
      },
      required: ['domain', 'key', 'data'],
    },
  },
  {
    name: 'get_knowledge',
    description: 'Retrieve a single knowledge entry by domain and key.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Knowledge domain' },
        key: { type: 'string', description: 'Document key' },
      },
      required: ['domain', 'key'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search knowledge entries using JSONB containment queries. The query object matches entries whose data contains the specified key-value pairs.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Knowledge domain to search' },
        query: { type: 'object', description: 'JSONB containment query' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
      required: ['domain', 'query'],
    },
  },
  {
    name: 'list_knowledge',
    description: 'List knowledge entries in a domain, optionally filtered by tags. Returns most recently updated first.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Knowledge domain' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        limit: { type: 'number', description: 'Max results (default 50)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'delete_knowledge',
    description: 'Delete a knowledge entry by domain and key.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Knowledge domain' },
        key: { type: 'string', description: 'Document key to delete' },
      },
      required: ['domain', 'key'],
    },
  },
  {
    name: 'list_domains',
    description: 'List all knowledge domains with entry counts and last-updated timestamps.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'append_knowledge',
    description: 'Append a value to an array field within a knowledge entry. Creates the entry and array if they do not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Knowledge domain' },
        key: { type: 'string', description: 'Document key' },
        path: { type: 'string', description: 'JSONB path to array field' },
        value: { description: 'Value to append to the array' },
      },
      required: ['domain', 'key', 'path', 'value'],
    },
  },
];
