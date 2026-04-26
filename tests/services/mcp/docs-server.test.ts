import { describe, it, expect, afterEach } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createDocsServer, stopDocsServer } from '../../../system/mcp-servers/docs';

function parseMcpResult(result: any): any {
  const text = result.content?.[0]?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { error: text }; }
}

async function connectClient(): Promise<McpClient> {
  const server = await createDocsServer({ name: 'test-docs' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClient({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  await stopDocsServer();
});

describe('Docs MCP Server', () => {
  it('should register 3 tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(3);
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['list_docs', 'read_doc', 'search_docs']);
    await client.close();
  });

  it('should list documentation files', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'list_docs', arguments: {} });
    const data = parseMcpResult(result);
    expect(data.docs).toBeDefined();
    expect(Array.isArray(data.docs)).toBe(true);
    expect(data.docs.length).toBeGreaterThan(10);
    // Should include known docs
    const paths = data.docs.map((d: any) => d.path);
    expect(paths).toContain('architecture.md');
    expect(paths).toContain('mcp.md');
    expect(paths.some((p: string) => p.startsWith('api/'))).toBe(true);
    await client.close();
  });

  it('should search across docs', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_docs',
      arguments: { query: 'escalation' },
    });
    const data = parseMcpResult(result);
    expect(data.matches).toBeDefined();
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches[0].path).toBeDefined();
    expect(data.matches[0].lines.length).toBeGreaterThan(0);
    await client.close();
  });

  it('should read a specific doc', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'read_doc',
      arguments: { path: 'architecture.md' },
    });
    const data = parseMcpResult(result);
    expect(data.content).toBeDefined();
    expect(data.content).toContain('# Architecture');
    expect(data.path).toBe('architecture.md');
    await client.close();
  });

  it('should return error for non-existent doc', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'read_doc',
      arguments: { path: 'nonexistent.md' },
    });
    const data = parseMcpResult(result);
    expect(data.error).toContain('not found');
    await client.close();
  });

  it('should return empty matches for unrelated search term', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'search_docs',
      arguments: { query: 'xyzzy_no_match_anywhere_12345' },
    });
    const data = parseMcpResult(result);
    expect(data.matches).toEqual([]);
    await client.close();
  });

  it('should read subdirectory docs (api/)', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'read_doc',
      arguments: { path: 'api/http/tasks.md' },
    });
    const data = parseMcpResult(result);
    expect(data.content).toBeDefined();
    expect(data.path).toBe('api/http/tasks.md');
    await client.close();
  });

  it('should include titles in list results', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'list_docs', arguments: {} });
    const data = parseMcpResult(result);
    const archDoc = data.docs.find((d: any) => d.path === 'architecture.md');
    expect(archDoc).toBeDefined();
    expect(archDoc.title).toBe('Architecture');
    await client.close();
  });
});
