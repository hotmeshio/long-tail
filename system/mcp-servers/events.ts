import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerRegistry } from '../../lib/logger';
import { eventRegistry } from '../../lib/events';
import type { LTEvent } from '../../types';

function registerTools(srv: McpServer): void {
  (srv as any).registerTool(
    'publish_event',
    {
      title: 'Publish Event',
      description: 'Publish a custom event to the event bus. Other agents can subscribe and react.',
      inputSchema: {
        topic: z.string().describe('Event topic (e.g., app.epic.apis.createorder.error)'),
        data: z.record(z.any()).optional().describe('Event payload data'),
        source: z.string().optional().describe('Source identifier'),
      },
    },
    async (args: { topic: string; data?: Record<string, any>; source?: string }) => {
      const topic = args.topic.startsWith('app.') ? args.topic : `app.${args.topic}`;

      // Custom `app.*` event: minimal envelope + data, no workflow fields.
      const event: LTEvent = {
        type: topic,
        source: args.source || 'mcp-tool',
        data: args.data,
        timestamp: new Date().toISOString(),
      };

      await eventRegistry.publish(event);

      // Auto-register topic in catalog (learn-on-first-use)
      const { upsertTopicOnPublish } = await import('../../services/topics');
      await upsertTopicOnPublish(topic, args.data, args.source || 'mcp-tool').catch(() => {});

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ published: true, topic, timestamp: event.timestamp }),
          },
        ],
      };
    },
  );

  (srv as any).registerTool(
    'list_subscriptions',
    {
      title: 'List Event Subscriptions',
      description: 'List all active agent event subscriptions.',
      inputSchema: {
        topic: z.string().optional().describe('Optional topic pattern to filter'),
      },
    },
    async (args: { topic?: string }) => {
      // Import lazily to avoid circular dependency at module load time
      const { listActiveSubscriptions } = await import('../../services/agent/subscriptions');
      const subs = await listActiveSubscriptions();

      const filtered = args.topic
        ? subs.filter((s: any) => s.topic.includes(args.topic!))
        : subs;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ subscriptions: filtered, total: filtered.length }),
          },
        ],
      };
    },
  );

  (srv as any).registerTool(
    'list_topics',
    {
      title: 'List Topics',
      description: 'Browse the topic catalog to discover available event topics, their descriptions, payload schemas, and subscriber counts.',
      inputSchema: {
        category: z.string().optional().describe('Filter by category (task, workflow, escalation, activity, knowledge, agent, app, milestone)'),
        search: z.string().optional().describe('Search topics by name or description'),
        limit: z.number().optional().describe('Max results (default 50)'),
      },
    },
    async (args: { category?: string; search?: string; limit?: number }) => {
      const { listTopics } = await import('../../services/topics');
      const result = await listTopics({
        category: args.category,
        search: args.search,
        limit: args.limit ?? 50,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  (srv as any).registerTool(
    'register_topic',
    {
      title: 'Register Topic',
      description: 'Declare a topic in the catalog with its description and payload schema before first publish.',
      inputSchema: {
        topic: z.string().describe('Topic name (e.g., app.vendor.orders.created)'),
        description: z.string().optional().describe('Human-readable description'),
        category: z.string().optional().describe('Category (defaults to first segment or "app")'),
        payload_schema: z.record(z.any()).optional().describe('JSON Schema for event.data'),
        tags: z.array(z.string()).optional().describe('Tags for filtering'),
      },
    },
    async (args: { topic: string; description?: string; category?: string; payload_schema?: Record<string, any>; tags?: string[] }) => {
      const { createTopic } = await import('../../services/topics');
      const category = args.category || (args.topic.startsWith('app.') ? 'app' : args.topic.split('.')[0]);

      try {
        const entry = await createTopic({
          topic: args.topic,
          description: args.description,
          category,
          payload_schema: args.payload_schema,
          source: 'mcp-tool',
          tags: args.tags,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ registered: true, topic: entry }),
            },
          ],
        };
      } catch (err: any) {
        if (err.code === '23505') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ registered: false, error: `Topic "${args.topic}" already exists` }),
              },
            ],
          };
        }
        throw err;
      }
    },
  );
}

export async function createEventsServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-events';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:events] ${name} ready (4 tools)`);
  return instance;
}

export async function stopEventsServer(): Promise<void> {
  loggerRegistry.info('[lt-mcp:events] stopped');
}
