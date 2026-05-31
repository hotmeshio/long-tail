import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../lib/logger';
import { publishFileEvent } from '../../lib/events/publish';
import * as fileStorage from '../activities/file-storage';

const MIME_MAP: Record<string, string> = {
  '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/html',
  '.csv': 'text/csv', '.xml': 'application/xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
};

const writeFileSchema = z.object({
  path: z.string().describe('File path relative to storage root'),
  content: z.string().describe('File content (text or base64-encoded binary)'),
  encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8')
    .describe('Content encoding'),
});

const readFileSchema = z.object({
  path: z.string().describe('File path relative to storage root'),
  encoding: z.enum(['utf-8', 'base64']).optional().default('utf-8')
    .describe('Return encoding'),
});

const listFilesSchema = z.object({
  directory: z.string().optional().describe('Subdirectory to list (default: root)'),
  pattern: z.string().optional().describe('Glob-like filter pattern (e.g., "*.json")'),
  page_size: z.number().optional().describe('Max results per page (default 100)'),
  continuation_token: z.string().optional().describe('Pagination token from a previous response'),
});

const deleteFileSchema = z.object({
  path: z.string().describe('File path relative to storage root'),
});

export async function createFileStorageServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-file-storage';
  const instance = new McpServer({ name, version: '1.0.0' });

  (instance as any).registerTool(
    'write_file',
    {
      title: 'Write File',
      description: 'Write content to a file in storage. Creates directories as needed. Returns the storage reference and size.',
      inputSchema: writeFileSchema,
    },
    async (args: z.infer<typeof writeFileSchema>) => {
      const result = await fileStorage.writeFile(args);
      const ext = path.extname(args.path).toLowerCase();
      publishFileEvent({
        type: 'file.stored',
        path: args.path,
        size: result.size,
        mime: MIME_MAP[ext] || 'application/octet-stream',
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (instance as any).registerTool(
    'read_file',
    {
      title: 'Read File',
      description: 'Read file content from storage. Returns content, size, and detected MIME type.',
      inputSchema: readFileSchema,
    },
    async (args: z.infer<typeof readFileSchema>) => {
      try {
        const result = await fileStorage.readFile(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'list_files',
    {
      title: 'List Files',
      description: 'List files and directories at a storage prefix. Supports cursor-based pagination via continuation tokens. Returns file paths, sizes, timestamps, subdirectories, and a nextToken for the next page.',
      inputSchema: listFilesSchema,
    },
    async (args: z.infer<typeof listFilesSchema>) => {
      const result = await fileStorage.listFiles(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  (instance as any).registerTool(
    'delete_file',
    {
      title: 'Delete File',
      description: 'Remove a file from storage.',
      inputSchema: deleteFileSchema,
    },
    async (args: z.infer<typeof deleteFileSchema>) => {
      const result = await fileStorage.deleteFile(args);
      if (result.deleted) {
        publishFileEvent({ type: 'file.deleted', path: args.path });
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  loggerRegistry.info(`[lt-mcp:file-storage] ${name} ready (4 tools registered)`);
  return instance;
}
