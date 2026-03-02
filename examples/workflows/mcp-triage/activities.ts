import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createVisionServer } from '../../../services/mcp/vision-server';
import * as taskService from '../../../services/task';
import * as escalationService from '../../../services/escalation';
import type { LTTaskRecord } from '../../../types';

// ── In-process Vision MCP client (lazy singleton) ─────────────

let client: InstanceType<typeof McpClient> | null = null;

async function getClient(): Promise<InstanceType<typeof McpClient>> {
  if (client) return client;

  const server = await createVisionServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new McpClient({ name: 'mcp-triage-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function parseResult(result: any): any {
  if (result.content?.[0]?.text) {
    return JSON.parse(result.content[0].text);
  }
  return result;
}

// ── MCP tool activities ───────────────────────────────────────

/**
 * Query all completed tasks sharing an originId.
 * Gives the triage orchestrator full context of upstream work.
 */
export async function getUpstreamTasks(
  originId: string,
): Promise<LTTaskRecord[]> {
  const { tasks } = await taskService.listTasks({
    limit: 100,
  });
  // Filter to matching originId (listTasks doesn't support origin_id filter directly)
  return tasks.filter(t => t.origin_id === originId);
}

/**
 * List available document pages via Vision MCP server.
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
 * Rotate a document page image via Vision MCP server.
 * Returns the storage reference for the rotated image.
 */
export async function rotatePage(
  imageRef: string,
  degrees: number,
): Promise<string> {
  const c = await getClient();
  const result = await c.callTool({
    name: 'rotate_page',
    arguments: { image_ref: imageRef, degrees },
  });
  return parseResult(result).rotated_ref;
}

/**
 * Translate content via Vision MCP server.
 * Returns the translated text and detected source language.
 */
export async function translateContent(
  content: string,
  targetLanguage: string,
): Promise<{ translated_content: string; source_language: string }> {
  const c = await getClient();
  const result = await c.callTool({
    name: 'translate_content',
    arguments: { content, target_language: targetLanguage },
  });
  return parseResult(result);
}

/**
 * Create an escalation to the engineering team with a recommendation.
 * Used by the triage workflow to surface long-term fixes.
 */
export async function notifyEngineering(
  originId: string,
  description: string,
  metadata?: Record<string, any>,
): Promise<void> {
  await escalationService.createEscalation({
    type: 'triage_recommendation',
    subtype: 'pipeline_fix',
    modality: 'async',
    description,
    priority: 3,
    origin_id: originId,
    role: 'engineer',
    envelope: JSON.stringify({}),
    metadata: {
      ...metadata,
      source: 'mcp_triage',
      auto_generated: true,
    },
  });
}
