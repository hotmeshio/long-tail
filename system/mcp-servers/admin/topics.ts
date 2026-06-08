/**
 * Topic catalog tools — mirrors routes/topics.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/topics';
import {
  listTopicsSchema,
  getTopicSchema,
  createTopicSchema,
  updateTopicSchema,
  deleteTopicSchema,
} from './schemas';

export function registerTopicTools(server: McpServer): void {

  // mirrors GET /api/topics
  (server as any).registerTool(
    'list_topics',
    {
      title: 'List Topics',
      description:
        'List topics in the event catalog with optional category and search filters.',
      inputSchema: listTopicsSchema,
    },
    async (args: z.infer<typeof listTopicsSchema>) => {
      const result = await api.listTopics(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/topics/by-name/:topic
  (server as any).registerTool(
    'get_topic',
    {
      title: 'Get Topic',
      description: 'Get a single topic by name, including schema and example payload.',
      inputSchema: getTopicSchema,
    },
    async (args: z.infer<typeof getTopicSchema>) => {
      const result = await api.getTopic(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/topics
  (server as any).registerTool(
    'create_topic',
    {
      title: 'Create Topic',
      description:
        'Register a new topic in the event catalog. Topics document what ' +
        'events are published so agents can discover and subscribe.',
      inputSchema: createTopicSchema,
    },
    async (args: z.infer<typeof createTopicSchema>) => {
      const result = await api.createTopic(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors PUT /api/topics/by-name/:topic
  (server as any).registerTool(
    'update_topic',
    {
      title: 'Update Topic',
      description: 'Update a topic in the event catalog.',
      inputSchema: updateTopicSchema,
    },
    async (args: z.infer<typeof updateTopicSchema>) => {
      const result = await api.updateTopic(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors DELETE /api/topics/by-name/:topic
  (server as any).registerTool(
    'delete_topic',
    {
      title: 'Delete Topic',
      description: 'Delete a topic from the catalog (system topics are protected).',
      inputSchema: deleteTopicSchema,
    },
    async (args: z.infer<typeof deleteTopicSchema>) => {
      const result = await api.deleteTopic(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
