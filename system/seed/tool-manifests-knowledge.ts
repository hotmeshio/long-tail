// ── Knowledge store tool manifests ───────────────────────────────────────────

export const KNOWLEDGE_TOOLS = [
  {
    name: 'store_knowledge',
    description: 'Store a value in a 3-level additive hierarchy: domain > key > field. Upserts by domain+key — fields accumulate across calls. Same domain+key+field overwrites that field. When field is provided, data can be any type. When omitted, data must be an object.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Top level — groups entries by namespace (e.g. "screenshots", "config")' },
        key: { type: 'string', description: 'Second level — unique identifier within domain (e.g. "homepage")' },
        field: { type: 'string', description: 'Third level (leaf) — names a specific field. Different fields accumulate; same field overwrites.' },
        data: { description: 'The value to store. Any type when field is provided; must be an object when field is omitted.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Categorization tags (unioned on upsert)' },
      },
      required: ['domain', 'key', 'data'],
    },
  },
  {
    name: 'get_knowledge',
    description: 'Retrieve a single knowledge entry by domain and key.',
    read_safe: true,
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
    read_safe: true,
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
    read_safe: true,
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
    read_safe: false,
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
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'append_knowledge',
    description: 'Append a value to an array field within a knowledge entry. Creates the entry and array if they do not exist.',
    read_safe: false,
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
