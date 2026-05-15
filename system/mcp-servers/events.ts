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

      const event: LTEvent = {
        type: topic,
        source: args.source || 'mcp-tool',
        workflowId: '',
        workflowName: '',
        taskQueue: '',
        data: args.data,
        timestamp: new Date().toISOString(),
      };

      await eventRegistry.publish(event);

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
}

export async function createEventsServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-events';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:events] ${name} ready (2 tools)`);
  return instance;
}

export async function stopEventsServer(): Promise<void> {
  loggerRegistry.info('[lt-mcp:events] stopped');
}
