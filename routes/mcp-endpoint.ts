/**
 * MCP Streamable HTTP endpoint.
 *
 * Exposes long-tail's built-in MCP tools to external clients
 * (Claude Desktop, Cursor, other agents) via the standard MCP
 * streamable-http transport protocol.
 *
 * Stateless mode — each POST creates a fresh server+transport pair.
 * Auth via Bearer token (JWT or bot API key) in the Authorization header.
 *
 * Mount at /mcp:
 *   POST /mcp  → JSON-RPC messages (initialize, tools/list, tools/call)
 *   GET  /mcp  → 405 (no SSE in stateless mode)
 *   DELETE /mcp → 405 (no sessions in stateless mode)
 */

import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { requireAuth } from '../modules/auth';
import { loggerRegistry } from '../lib/logger';
import { createUnifiedMcpServer } from '../services/mcp/external-server';
import { getExposureConfig } from '../services/mcp/exposure';

const router = Router();

// All MCP endpoint requests require authentication
router.use(requireAuth);

// POST /mcp — JSON-RPC messages
router.post('/', async (req, res) => {
  try {
    const exposure = getExposureConfig();
    const callerScopes = (req.auth as any)?.scopes as string[] | undefined;
    const server = await createUnifiedMcpServer(exposure, callerScopes);

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
    loggerRegistry.error(`[lt-mcp:endpoint] error: ${err.message}`);
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
router.get('/', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Use POST for stateless requests.' },
    id: null,
  });
});

// DELETE /mcp — session close (not supported in stateless mode)
router.delete('/', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Stateless mode has no sessions.' },
    id: null,
  });
});

export default router;
