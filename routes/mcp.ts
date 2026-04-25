import { Router } from 'express';

import * as api from '../api/mcp';

const router = Router();

// ── Server registration CRUD ──────────────────────────────────────────

/**
 * GET /api/mcp/servers
 * List registered MCP servers.
 */
router.get('/servers', async (req, res) => {
  const tagsParam = req.query.tags as string | undefined;
  const result = await api.listMcpServers({
    status: req.query.status as any,
    auto_connect: req.query.auto_connect === 'true' ? true :
                  req.query.auto_connect === 'false' ? false : undefined,
    search: req.query.search as string | undefined,
    tags: tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/mcp/servers
 * Register a new MCP server.
 */
router.post('/servers', async (req, res) => {
  const { name, description, transport_type, transport_config, auto_connect, metadata, tags, compile_hints, credential_providers } = req.body;
  const result = await api.createMcpServer({
    name,
    description,
    transport_type,
    transport_config,
    auto_connect,
    metadata,
    tags,
    compile_hints,
    credential_providers,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/mcp/servers/test-connection
 * Test connectivity to an MCP server without persisting it.
 */
router.post('/servers/test-connection', async (req, res) => {
  const { transport_type, transport_config } = req.body;
  const result = await api.testConnection({ transport_type, transport_config });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Parameterized routes (must come after literal paths) ──────────────

/**
 * GET /api/mcp/servers/:id
 * Get a specific MCP server.
 */
router.get('/servers/:id', async (req, res) => {
  const result = await api.getMcpServer({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/mcp/servers/:id
 * Update an MCP server registration.
 */
router.put('/servers/:id', async (req, res) => {
  const result = await api.updateMcpServer({ id: req.params.id, ...req.body });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/mcp/servers/:id
 * Delete an MCP server registration.
 */
router.delete('/servers/:id', async (req, res) => {
  const result = await api.deleteMcpServer({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Connection management ─────────────────────────────────────────────

/**
 * POST /api/mcp/servers/:id/connect
 * Connect to a registered MCP server.
 */
router.post('/servers/:id/connect', async (req, res) => {
  const result = await api.connectMcpServer({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/mcp/servers/:id/disconnect
 * Disconnect from a specific MCP server.
 */
router.post('/servers/:id/disconnect', async (req, res) => {
  const result = await api.disconnectMcpServer({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Credential status ────────────────────────────────────────────────

/**
 * GET /api/mcp/servers/:id/credential-status
 * Check which credential providers are required and which the user has.
 */
router.get('/servers/:id/credential-status', async (req, res) => {
  const result = await api.getCredentialStatus(
    { id: req.params.id },
    req.auth ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Tool operations ───────────────────────────────────────────────────

/**
 * GET /api/mcp/servers/:id/tools
 * List tools available on a connected MCP server.
 */
router.get('/servers/:id/tools', async (req, res) => {
  const result = await api.listMcpServerTools({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/mcp/servers/:id/tools/:toolName/call
 * Call a tool on a connected MCP server.
 * Body: { arguments: { ... } }
 */
router.post('/servers/:id/tools/:toolName/call', async (req, res) => {
  const result = await api.callMcpTool(
    {
      id: req.params.id,
      toolName: req.params.toolName,
      arguments: req.body.arguments,
      execute_as: req.body.execute_as,
    },
    req.auth ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
