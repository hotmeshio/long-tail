import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createVisionServer, stopVisionServer } from '../../../services/mcp/vision-server';
import type { MemberInfo } from '../verify-document/types';

// ── In-process Vision MCP client (lazy singleton) ─────────────
//
// The MCP SDK only allows one transport per server instance. To avoid
// "Already connected to a transport" errors when the Durable worker
// forks or replays, we tear down the previous server before
// reconnecting. The server is cheap to recreate (no network I/O).

let client: InstanceType<typeof McpClient> | null = null;

async function getClient(): Promise<InstanceType<typeof McpClient>> {
  if (client) return client;

  // Ensure any previous server connection is closed before reconnecting
  await stopVisionServer();

  const server = await createVisionServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new McpClient({ name: 'verify-mcp-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function parseResult(result: any): any {
  const text = result.content?.[0]?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

// ── MCP-wrapped activities ────────────────────────────────────
// Same signatures as workflows/verify-document/activities.ts,
// but each call routes through the Vision MCP server.

/**
 * List available document pages via MCP tool call.
 */
export async function listDocumentPages(): Promise<string[]> {
  const c = await getClient();
  const result = await c.callTool({
    name: 'list_document_pages',
    arguments: {},
  });
  return parseResult(result).pages;
}

/**
 * Extract member information from a document page image via MCP tool call.
 * Calls the Vision MCP server, which calls OpenAI Vision (gpt-4o-mini).
 */
export async function extractMemberInfo(
  imageRef: string,
  pageNumber: number,
): Promise<MemberInfo | null> {
  const c = await getClient();
  const result = await c.callTool({
    name: 'extract_member_info',
    arguments: { image_ref: imageRef, page_number: pageNumber },
  });
  return parseResult(result).member_info;
}

/**
 * Validate extracted member info against the member database via MCP tool call.
 */
export async function validateMember(
  memberInfo: MemberInfo,
): Promise<{
  result: 'match' | 'mismatch' | 'not_found';
  databaseRecord?: Record<string, any>;
}> {
  const c = await getClient();
  const result = await c.callTool({
    name: 'validate_member',
    arguments: { member_info: memberInfo },
  });
  return parseResult(result);
}
