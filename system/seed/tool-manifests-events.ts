// ── Events tool manifests ────────────────────────────────────────────────────
// Each entry mirrors the exact tool registered in system/mcp-servers/events.ts

export const EVENTS_TOOLS = [
  {
    name: 'publish_event',
    description: 'Publish a custom event to the event bus. Other agents and workflows can subscribe to these events and react. Topics follow the convention: app.{namespace}.{entity}.{action} (e.g., app.epic.apis.createorder.error, app.vendor.schema.drift).',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Event topic using dot-delimited segments (e.g., app.epic.apis.createorder.error). The "app." prefix is auto-added if omitted.' },
        data: { type: 'object', description: 'Event payload — any structured data relevant to the event.' },
        source: { type: 'string', description: 'Source identifier (agent name, workflow type, or free-form label).' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'list_subscriptions',
    description: 'List all active agent event subscriptions, optionally filtered by topic pattern.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Optional topic pattern to filter subscriptions.' },
      },
    },
  },
  {
    name: 'list_topics',
    description: 'Browse the topic catalog to discover available event topics, their descriptions, payload schemas, and subscriber counts. Use this to understand what events are available before subscribing or publishing.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (task, workflow, escalation, activity, knowledge, agent, app, milestone).' },
        search: { type: 'string', description: 'Search topics by name or description.' },
        limit: { type: 'number', description: 'Max results (default 50).' },
      },
    },
  },
  {
    name: 'register_topic',
    description: 'Declare a topic in the catalog with its description and payload schema. Use this to pre-register topics before first publish so other agents can discover them.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic name (e.g., app.vendor.orders.created).' },
        description: { type: 'string', description: 'Human-readable description of the event.' },
        category: { type: 'string', description: 'Category (defaults to first segment or "app").' },
        payload_schema: { type: 'object', description: 'JSON Schema describing the event.data shape.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering.' },
      },
      required: ['topic'],
    },
  },
];
