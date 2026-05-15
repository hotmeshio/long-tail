// ── Events tool manifests ────────────────────────────────────────────────────
// Each entry mirrors the exact tool registered in system/mcp-servers/events.ts

export const EVENTS_TOOLS = [
  {
    name: 'publish_event',
    description: 'Publish a custom event to the event bus. Other agents and workflows can subscribe to these events and react. Topics follow the convention: app.{namespace}.{entity}.{action} (e.g., app.epic.apis.createorder.error, app.vendor.schema.drift).',
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
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Optional topic pattern to filter subscriptions.' },
      },
    },
  },
];
