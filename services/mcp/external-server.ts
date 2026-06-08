/**
 * Unified MCP server for external clients.
 *
 * Aggregates tools from all shipped built-in servers into a single
 * McpServer instance that can be connected to a StreamableHTTPServerTransport.
 * Created per-request in stateless mode (pure in-memory, no IO).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { loggerRegistry } from '../../lib/logger';
import { builtinMcpServerFactories } from '../../system';
import type { ExposureConfig } from './exposure';

// ── Shipped server allowlist ─────────────────────────────────────────────────
// Only these servers are exposed via the /mcp endpoint.
// Example servers (playwright, gmail, image-tools) are excluded.

const SHIPPED_SERVERS = new Set([
  'long-tail-admin',
  'long-tail-human-queue',
  'long-tail-file-storage',
  'long-tail-http-fetch',
  'long-tail-schema-exchange',
  'long-tail-oauth',
  'long-tail-knowledge',
  'long-tail-docs',
  'long-tail-events',
  'long-tail-vision',
  'long-tail-translation',
  'long-tail-claude-code',
]);

// ── Server instance cache ────────────────────────────────────────────────────
// Built-in servers are lazily created once and reused across requests.
// Tool handlers are stateless — safe to share.

const serverCache = new Map<string, any>();

async function getOrCreateServer(name: string): Promise<any> {
  if (serverCache.has(name)) return serverCache.get(name)!;

  const entry = builtinMcpServerFactories[name];
  if (!entry) return null;

  const server = await entry.factory();
  serverCache.set(name, server);
  return server;
}

// ── Exposure filtering ───────────────────────────────────────────────────────

function isServerAllowed(name: string, exposure?: ExposureConfig): boolean {
  if (!SHIPPED_SERVERS.has(name)) return false;

  if (exposure?.allowServers?.length) {
    if (!exposure.allowServers.includes(name)) return false;
  }
  if (exposure?.denyServers?.length) {
    if (exposure.denyServers.includes(name)) return false;
  }
  if (exposure?.hideAiWhenUnavailable !== false) {
    const config = builtinMcpServerFactories[name]?.config;
    if (config?.aiRequired) {
      const hasKey = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
      if (!hasKey) return false;
    }
  }
  return true;
}

function isToolAllowed(
  toolName: string,
  serverName: string,
  exposure?: ExposureConfig,
  callerScopes?: string[],
): boolean {
  // Per-caller scope filtering: mcp:read callers only see read_safe tools
  const isReadOnly = exposure?.readOnly
    || (callerScopes?.length && callerScopes.includes('mcp:read') && !callerScopes.includes('mcp:full'));

  if (!isReadOnly) return true;

  // Check read_safe in the tool manifest
  const config = builtinMcpServerFactories[serverName]?.config;
  const manifest = config?.toolManifest;
  if (!manifest) return true; // no manifest = allow (conservative)

  const entry = manifest.find((t) => t.name === toolName);
  return entry?.read_safe !== false; // allow if read_safe is true or absent
}

// ── Unified server creation ──────────────────────────────────────────────────

/**
 * Create a unified McpServer with tools from all qualifying shipped servers.
 * Called per-request in stateless mode. Server instances are cached; only
 * the McpServer wrapper and tool registrations are fresh (pure in-memory).
 */
export async function createUnifiedMcpServer(
  exposure?: ExposureConfig,
  callerScopes?: string[],
): Promise<McpServer> {
  const unified = new McpServer({ name: 'long-tail', version: '1.0.0' });
  const registered = new Set<string>();

  for (const [name, entry] of Object.entries(builtinMcpServerFactories)) {
    if (!isServerAllowed(name, exposure)) continue;

    const server = await getOrCreateServer(name);
    if (!server) continue;

    const tools = (server as any)._registeredTools as Record<string, any> | undefined;
    if (!tools) continue;

    for (const [toolName, tool] of Object.entries(tools)) {
      if (!tool?.handler || !tool.enabled) continue;
      if (!isToolAllowed(toolName, name, exposure, callerScopes)) continue;

      // Deduplicate: prefix with server short name on collision
      let finalName = toolName;
      if (registered.has(toolName)) {
        const prefix = name.replace('long-tail-', '').replace(/-/g, '_');
        finalName = `${prefix}_${toolName}`;
        if (registered.has(finalName)) continue; // still a collision — skip
      }
      registered.add(finalName);

      // Re-register the tool handler on the unified server.
      // Use the low-level `tool()` API since we already have the parsed handler.
      (unified as any).registerTool(
        finalName,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        tool.handler,
      );
    }
  }

  loggerRegistry.info(`[lt-mcp:endpoint] unified server ready (${registered.size} tools)`);
  return unified;
}
