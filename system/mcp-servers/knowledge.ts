import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../lib/logger';
import * as knowledge from '../activities/knowledge';

const storeSchema = z.object({
  domain: z.string().describe('Namespace grouping related entries (e.g. "screenshots", "config", "analysis").'),
  key: z.string().describe('Unique identifier within the domain (e.g. "google", "user_profile").'),
  field: z.string().optional().describe('RECOMMENDED. Names a specific field to set within the entry (e.g. "2026-05-09", "url", "score"). Using field is additive — it merges into existing data without clobbering other fields. Without field, the entire data object is merged at the top level, which can overwrite existing fields with the same keys. Always use field when adding to an entry that may already have data.'),
  data: z.any().describe('The value to store. When field is provided, this can be any type (string, number, boolean, object, array) and is stored as { [field]: data }. When field is omitted, data must be a JSON object whose keys merge into existing data.'),
  tags: z.array(z.string()).optional().describe('Categorization tags (unioned on upsert)'),
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
  offset: z.number().optional().describe('Pagination offset'),
});

const listSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  search: z.string().optional().describe('Search by key name or tag (partial match)'),
  tags: z.array(z.string()).optional().describe('Filter by tags (any match)'),
  limit: z.number().optional().describe('Max results (default 50, max 200)'),
  offset: z.number().optional().describe('Pagination offset'),
});

const deleteSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  key: z.string().describe('Document key to delete'),
});

const setFieldSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  key: z.string().describe('Document key'),
  path: z.string().describe('Dot-notation path to the field (e.g. "google.holiday", "config.retries"). Sets the value at this exact path without overwriting sibling fields.'),
  value: z.any().refine((v) => v !== undefined, 'value is required').describe('Value to set — any JSON type (string, number, boolean, object, array)'),
  tags: z.array(z.string()).optional().describe('Tags to union with existing tags'),
});

const removeFieldSchema = z.object({
  domain: z.string().describe('Knowledge domain'),
  key: z.string().describe('Document key'),
  path: z.string().describe('Dot-notation path to remove (e.g. "google.legacy_data", "temp.cache")'),
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
      description:
        'Store a value in the knowledge base using a 3-level hierarchy: domain > key > field. ' +
        'IMPORTANT: Always use the field parameter when adding data to an existing entry — ' +
        'it merges additively without clobbering other fields. Without field, top-level keys ' +
        'in data overwrite existing keys with the same name. ' +
        'Example: domain="screenshots", key="google", field="2026-05-10", data="description text".',
      inputSchema: storeSchema,
    },
    async (args: z.infer<typeof storeSchema>) => {
      // When field is provided, wrap the data value as { [field]: data }
      // so it merges into the JSONB column at the field level.
      // When field is omitted, data must be a plain object — reject strings,
      // arrays, and primitives that would corrupt the JSONB merge
      // (Postgres `object || string` produces an array, not a merge).
      let dataObj: Record<string, any>;
      if (args.field != null) {
        dataObj = { [args.field]: args.data };
      } else {
        if (args.data == null || typeof args.data !== 'object' || Array.isArray(args.data)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'When field is omitted, data must be a JSON object. Use the field parameter to store strings and other primitives.',
              }),
            }],
          };
        }
        dataObj = args.data;
      }
      const result = await knowledge.storeKnowledge({
        domain: args.domain, key: args.key, data: dataObj, tags: args.tags,
      });
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

  (server as any).registerTool(
    'set_knowledge_field',
    {
      title: 'Set Knowledge Field',
      description:
        'RECOMMENDED for updating existing entries. Set a value at a specific path within a knowledge entry ' +
        'without overwriting sibling fields. Use dot-notation for nested paths (e.g. "google.holiday" sets ' +
        'data.google.holiday while preserving data.google.description). Creates the entry if it does not exist. ' +
        'Use this instead of store_knowledge when the entry may already have data you want to preserve.',
      inputSchema: setFieldSchema,
    },
    async (args: z.infer<typeof setFieldSchema>) => {
      const result = await knowledge.setKnowledgeField(args as { domain: string; key: string; path: string; value: any; tags?: string[] });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (server as any).registerTool(
    'remove_knowledge_field',
    {
      title: 'Remove Knowledge Field',
      description:
        'Remove a specific field from a knowledge entry by dot-path. The entry survives — only the targeted ' +
        'path is deleted. Use this for intentional cleanup of obsolete or incorrect fields.',
      inputSchema: removeFieldSchema,
    },
    async (args: z.infer<typeof removeFieldSchema>) => {
      const result = await knowledge.removeKnowledgeField(args);
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
