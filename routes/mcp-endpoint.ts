/**
 * MCP Streamable HTTP endpoint.
 *
 * Exposes long-tail's built-in MCP tools to external clients
 * (Claude Desktop, Cursor, other agents) via the standard MCP
 * streamable-http transport protocol.
 *
 * Stateless mode — each POST creates a fresh server+transport pair.
 * Auth via Bearer token (JWT, bot API key, or OAuth access token) in the
 * Authorization header.
 * The caller sees only the tools whose manifest gate they hold.
 *
 * Mount at /mcp:
 *   POST /mcp  → JSON-RPC messages (initialize, tools/list, tools/call)
 *   GET  /mcp  → 405 (no SSE in stateless mode)
 *   DELETE /mcp → 405 (no sessions in stateless mode)
 */

import { Router } from '../lib/http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { requireMcpAuth } from '../modules/mcp-auth';
import { capabilityAccess } from '../modules/capabilities';
import { loggerRegistry } from '../lib/logger';
import { createUnifiedMcpServer } from '../services/mcp/external-server';
import { getExposureConfig } from '../services/mcp/exposure';

const router = Router();

/** The tool a single `tools/call` message names; undefined for anything else. */
function requestedToolName(body: unknown): string | undefined {
  const message = body as { method?: unknown; params?: { name?: unknown } } | undefined;
  if (message?.method !== 'tools/call') return undefined;
  return typeof message.params?.name === 'string' ? message.params.name : undefined;
}

// POST /mcp — JSON-RPC messages
router.post('/', requireMcpAuth, async (req, res) => {
  try {
    const exposure = getExposureConfig();
    const callerScopes = (req.auth as any)?.scopes as string[] | undefined;
    const server = await createUnifiedMcpServer(capabilityAccess(req.auth), exposure, callerScopes, requestedToolName(req.body));

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, req.body);
  } catch (err: any) {
    // Log the full stack, not just the message — otherwise a 500 here is
    // undiagnosable from the deployment logs (the caller only sees a generic
    // "Internal server error").
    loggerRegistry.error(`[lt-mcp:endpoint] error: ${err?.stack || err?.message || err}`);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// GET /mcp — SSE stream (not supported in stateless mode)
router.get('/', requireMcpAuth, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Use POST for stateless requests.' },
    id: null,
  });
});

// DELETE /mcp — session close (not supported in stateless mode)
router.delete('/', requireMcpAuth, (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Stateless mode has no sessions.' },
    id: null,
  });
});

export default router;
