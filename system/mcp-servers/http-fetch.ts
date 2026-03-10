import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../services/logger';
import * as http from '../activities/http';

const httpRequestSchema = z.object({
  url: z.string().describe('URL to request'),
  method: z.string().optional().default('GET').describe('HTTP method'),
  headers: z.record(z.string()).optional().describe('Request headers'),
  body: z.string().optional().describe('Request body'),
  timeout_ms: z.number().optional().describe('Request timeout in milliseconds'),
});

const fetchJsonSchema = z.object({
  url: z.string().describe('URL to fetch JSON from'),
  headers: z.record(z.string()).optional().describe('Request headers'),
});

const fetchTextSchema = z.object({
  url: z.string().describe('URL to fetch text from'),
  headers: z.record(z.string()).optional().describe('Request headers'),
});

export async function createHttpFetchServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-http-fetch';
  const instance = new McpServer({ name, version: '1.0.0' });

  (instance as any).registerTool(
    'http_request',
    {
      title: 'HTTP Request',
      description: 'Make an HTTP request to any URL. Supports all methods, custom headers, and request bodies. Returns status, headers, and body.',
      inputSchema: httpRequestSchema,
    },
    async (args: z.infer<typeof httpRequestSchema>) => {
      try {
        const result = await http.httpRequest(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'fetch_json',
    {
      title: 'Fetch JSON',
      description: 'GET a URL and parse the response as JSON. Convenience wrapper around http_request.',
      inputSchema: fetchJsonSchema,
    },
    async (args: z.infer<typeof fetchJsonSchema>) => {
      try {
        const result = await http.fetchJson(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'fetch_text',
    {
      title: 'Fetch Text',
      description: 'GET a URL and return the response as text. Returns content, status, and content type.',
      inputSchema: fetchTextSchema,
    },
    async (args: z.infer<typeof fetchTextSchema>) => {
      try {
        const result = await http.fetchText(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  loggerRegistry.info(`[lt-mcp:http-fetch] ${name} ready (3 tools registered)`);
  return instance;
}
