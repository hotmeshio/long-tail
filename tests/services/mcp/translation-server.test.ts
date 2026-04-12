import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createTranslationServer, stopTranslationServer } from '../../../system/mcp-servers/translation';

function parseMcpResult(result: any): any {
  const text = result.content?.[0]?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { error: text }; }
}

async function connectClient(): Promise<McpClient> {
  const server = await createTranslationServer({ name: 'test-translation' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClient({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  await stopTranslationServer();
  vi.restoreAllMocks();
});

describe('Translation MCP Server', () => {
  it('should register 1 tool', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('translate_content');
    await client.close();
  });

  it('should return content unchanged when LLM key not configured', async () => {
    const llm = await import('../../../services/llm');
    vi.spyOn(llm, 'hasLLMApiKey').mockReturnValue(false);

    const client = await connectClient();
    const result = await client.callTool({
      name: 'translate_content',
      arguments: { content: 'Hola mundo', target_language: 'en' },
    });
    const data = parseMcpResult(result);
    expect(data.translated_content).toBe('Hola mundo');
    expect(data.target_language).toBe('en');
    expect(data.note).toContain('LLM API key not configured');
    await client.close();
  });

  it('should preserve source_language when LLM key not configured', async () => {
    const llm = await import('../../../services/llm');
    vi.spyOn(llm, 'hasLLMApiKey').mockReturnValue(false);

    const client = await connectClient();
    const result = await client.callTool({
      name: 'translate_content',
      arguments: { content: 'Hola mundo', target_language: 'en', source_language: 'es' },
    });
    const data = parseMcpResult(result);
    expect(data.translated_content).toBe('Hola mundo');
    expect(data.source_language).toBe('es');
    expect(data.target_language).toBe('en');
    await client.close();
  });

  it('should allow multiple independent server instances', async () => {
    const server1 = await createTranslationServer({ name: 'test-translation-1' });
    const server2 = await createTranslationServer({ name: 'test-translation-2' });
    expect(server1).not.toBe(server2);

    const [c1t, s1t] = InMemoryTransport.createLinkedPair();
    const [c2t, s2t] = InMemoryTransport.createLinkedPair();
    await server1.connect(s1t);
    await server2.connect(s2t);

    const client1 = new McpClient({ name: 'c1', version: '1.0.0' });
    await client1.connect(c1t);
    const client2 = new McpClient({ name: 'c2', version: '1.0.0' });
    await client2.connect(c2t);

    const r1 = await client1.listTools();
    const r2 = await client2.listTools();
    expect(r1.tools.length).toBe(1);
    expect(r2.tools.length).toBe(1);

    await client1.close();
    await client2.close();
  });
});
