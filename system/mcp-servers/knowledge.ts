import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../services/logger';
import * as knowledge from '../activities/knowledge';

const storeSchema = z.object({
  domain: z.string().describe('Knowledge domain (namespace)'),
  key: z.string().describe('Unique key within domain'),
  data: z.record(z.any()).describe('JSONB payload to store'),
  tags: z.array(z.string()).optional().describe('Categorization tags'),
});

const getSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  key: z.string().describe('Document key'),
});

const searchSchema = z.object({
  domain: z.string().describe('Knowledge domain to search'),
  query: z.record(z.any()).describe('JSONB containment query (e.g. {"type":"screenshot"})'),
  tags: z.array(z.string()).optional().describe('Filter by tags (any match)'),
  limit: z.number().optional().describe('Max results (default 50, max 200)'),
});

const listSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  tags: z.array(z.string()).optional().describe('Filter by tags (any match)'),
  limit: z.number().optional().describe('Max results (default 50, max 200)'),
  offset: z.number().optional().describe('Pagination offset'),
});

const deleteSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  key: z.string().describe('Document key to delete'),
});

const appendSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  key: z.string().describe('Document key'),
  path: z.string().describe('JSONB path to array field (e.g. "screenshots" or "analysis.variations")'),
  value: z.any().refine((v) => v !== undefined, 'value is required').describe('Value to append to the array'),
});

function registerTools(server: McpServer) {
  (server as any).registerTool(
    'store_knowledge',
    {
      title: 'Store Knowledge',
      description: 'Store or update a knowledge entry. Upserts by domain+key: merges data and unions tags if the entry already exists.',
      inputSchema: storeSchema,
    },
    async (args: z.infer<typeof storeSchema>) => {
      const result = await knowledge.storeKnowledge(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (server as any).registerTool(
    'get_knowledge',
    {
      title: 'Get Knowledge',
      description: 'Retrieve a single knowledge entry by domain and key.',
      inputSchema: getSchema,
    },
    async (args: z.infer<typeof getSchema>) => {
      const result = await knowledge.getKnowledge(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (server as any).registerTool(
    'search_knowledge',
    {
      title: 'Search Knowledge',
      description: 'Search knowledge entries using JSONB containment queries. The query object matches entries whose data contains the specified key-value pairs.',
      inputSchema: searchSchema,
    },
    async (args: z.infer<typeof searchSchema>) => {
      const result = await knowledge.searchKnowledge(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (server as any).registerTool(
    'list_knowledge',
    {
      title: 'List Knowledge',
      description: 'List knowledge entries in a domain, optionally filtered by tags. Returns most recently updated first.',
      inputSchema: listSchema,
    },
    async (args: z.infer<typeof listSchema>) => {
      const result = await knowledge.listKnowledge(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (server as any).registerTool(
    'delete_knowledge',
    {
      title: 'Delete Knowledge',
      description: 'Delete a knowledge entry by domain and key.',
      inputSchema: deleteSchema,
    },
    async (args: z.infer<typeof deleteSchema>) => {
      const result = await knowledge.deleteKnowledge(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (server as any).registerTool(
    'list_domains',
    {
      title: 'List Knowledge Domains',
      description: 'List all knowledge domains with entry counts and last-updated timestamps.',
      inputSchema: z.object({}),
    },
    async () => {
      const result = await knowledge.listDomains();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (server as any).registerTool(
    'append_knowledge',
    {
      title: 'Append to Knowledge',
      description: 'Append a value to an array field within a knowledge entry. Creates the entry and array if they do not exist.',
      inputSchema: appendSchema,
    },
    async (args: z.infer<typeof appendSchema>) => {
      const result = await knowledge.appendKnowledge(args as { domain: string; key: string; path: string; value: any });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );
}

export async function createKnowledgeServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-knowledge';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:knowledge] ${name} ready`);
  return instance;
}
