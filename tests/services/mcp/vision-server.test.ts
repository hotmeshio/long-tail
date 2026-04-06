import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createVisionServer, stopVisionServer } from '../../../services/mcp/vision-server';

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures');

function parseMcpResult(result: any): any {
  const text = result.content?.[0]?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { error: text }; }
}

async function connectClient(): Promise<McpClient> {
  const server = await createVisionServer({ name: 'test-vision' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new McpClient({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  // Clean up any rotated files created during tests
  const files = fs.readdirSync(FIXTURES_DIR);
  for (const f of files) {
    if (f.includes('_rotated') && f.endsWith('.png')) {
      fs.unlinkSync(path.join(FIXTURES_DIR, f));
    }
  }
  await stopVisionServer();
});

describe('Vision MCP Server', () => {
  it('should register 3 tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(3);

    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'list_document_pages',
      'rotate_page',
      'translate_content',
    ]);
    await client.close();
  });

  it('should list document pages from fixtures', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'list_document_pages',
      arguments: {},
    });
    const data = parseMcpResult(result);
    expect(data.pages).toBeDefined();
    expect(Array.isArray(data.pages)).toBe(true);
    expect(data.pages.length).toBeGreaterThanOrEqual(2);
    // Should include our fixture files
    expect(data.pages.some((p: string) => p.includes('page1'))).toBe(true);
    expect(data.pages.some((p: string) => p.includes('page2'))).toBe(true);
    await client.close();
  });

  it('should rotate an image with sharp and produce a valid file', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'rotate_page',
      arguments: { image_ref: 'page1_upside_down.png', degrees: 180 },
    });
    const data = parseMcpResult(result);
    expect(data.rotated_ref).toBe('page1_upside_down_rotated.png');
    expect(data.degrees).toBe(180);
    expect(data.source_ref).toBe('page1_upside_down.png');

    // Verify the rotated file was actually created
    const rotatedPath = path.join(FIXTURES_DIR, 'page1_upside_down_rotated.png');
    expect(fs.existsSync(rotatedPath)).toBe(true);

    // Verify it's a valid PNG (check file size > 0)
    const stat = fs.statSync(rotatedPath);
    expect(stat.size).toBeGreaterThan(1000);

    await client.close();
  });

  it('should return error when rotating a non-existent image', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'rotate_page',
      arguments: { image_ref: 'nonexistent.png', degrees: 90 },
    });
    const data = parseMcpResult(result);
    expect(data.error).toContain('Image not found');
    await client.close();
  });

  // Multiple independent instances can be created and connected
  it('should allow multiple independent server instances', async () => {
    const server1 = await createVisionServer({ name: 'test-vision-1' });
    const server2 = await createVisionServer({ name: 'test-vision-2' });
    expect(server1).not.toBe(server2);

    // Both can connect to separate transports without conflict
    const [c1t, s1t] = InMemoryTransport.createLinkedPair();
    const [c2t, s2t] = InMemoryTransport.createLinkedPair();
    await server1.connect(s1t);
    await server2.connect(s2t);

    const client1 = new McpClient({ name: 'c1', version: '1.0.0' });
    await client1.connect(c1t);
    const client2 = new McpClient({ name: 'c2', version: '1.0.0' });
    await client2.connect(c2t);

    // Both work independently
    const r1 = await client1.listTools();
    const r2 = await client2.listTools();
    expect(r1.tools.length).toBe(3);
    expect(r2.tools.length).toBe(3);

    await client1.close();
    await client2.close();
  });
});
