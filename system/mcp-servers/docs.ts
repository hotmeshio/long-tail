import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loggerRegistry } from '../../lib/logger';

// Resolve docs directory (works from ts-node root and compiled build/)
function docsDir(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'docs'),
    path.join(__dirname, '..', '..', '..', 'docs'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function listMarkdownFiles(dir: string, prefix = ''): { path: string; title: string }[] {
  if (!fs.existsSync(dir)) return [];
  const results: { path: string; title: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listMarkdownFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
      const firstLine = content.split('\n').find(l => l.startsWith('# '));
      const title = firstLine ? firstLine.replace(/^#\s+/, '') : entry.name;
      results.push({ path: rel, title });
    }
  }
  return results;
}

const listDocsSchema = z.object({});

const searchDocsSchema = z.object({
  query: z.string().describe('Search term or phrase to find in documentation'),
});

const readDocSchema = z.object({
  path: z.string().describe('Document path relative to docs/ (e.g. "mcp.md" or "api/tasks.md")'),
});

function registerTools(srv: McpServer): void {
  (srv as any).registerTool(
    'list_docs',
    {
      title: 'List Documentation',
      description: 'List all available documentation files with their titles.',
      inputSchema: listDocsSchema,
    },
    async () => {
      const docs = listMarkdownFiles(docsDir());
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ docs }) }],
      };
    },
  );

  (srv as any).registerTool(
    'search_docs',
    {
      title: 'Search Documentation',
      description: 'Search across all documentation for a keyword or phrase. Returns matching files with line context.',
      inputSchema: searchDocsSchema,
    },
    async (args: z.infer<typeof searchDocsSchema>) => {
      const dir = docsDir();
      const files = listMarkdownFiles(dir);
      const query = args.query.toLowerCase();
      const matches: { path: string; title: string; lines: string[] }[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file.path), 'utf-8');
        const fileLines = content.split('\n');
        const hits: string[] = [];
        for (let i = 0; i < fileLines.length; i++) {
          if (fileLines[i].toLowerCase().includes(query)) {
            // Include surrounding context
            const start = Math.max(0, i - 1);
            const end = Math.min(fileLines.length, i + 2);
            hits.push(fileLines.slice(start, end).join('\n'));
          }
        }
        if (hits.length > 0) {
          matches.push({ path: file.path, title: file.title, lines: hits.slice(0, 5) });
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ query: args.query, matches }) }],
      };
    },
  );

  (srv as any).registerTool(
    'read_doc',
    {
      title: 'Read Documentation',
      description: 'Read the full content of a documentation file.',
      inputSchema: readDocSchema,
    },
    async (args: z.infer<typeof readDocSchema>) => {
      const filePath = path.join(docsDir(), args.path);
      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Document not found: ${args.path}` }) }],
        };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ path: args.path, content }) }],
      };
    },
  );
}

export async function createDocsServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-docs';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  const docs = listMarkdownFiles(docsDir());
  loggerRegistry.info(`[lt-mcp:docs] ${name} ready (3 tools, ${docs.length} docs indexed)`);
  return instance;
}

export async function stopDocsServer(): Promise<void> {
  loggerRegistry.info('[lt-mcp:docs] stopped');
}
