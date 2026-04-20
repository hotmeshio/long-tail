import { Router } from 'express';

import * as mcpDbService from '../services/mcp/db';
import { mcpRegistry } from '../services/mcp';

const router = Router();

// ── Server registration CRUD ──────────────────────────────────────────

/**
 * GET /api/mcp/servers
 * List registered MCP servers.
 */
router.get('/servers', async (req, res) => {
  try {
    const tagsParam = req.query.tags as string | undefined;
    const result = await mcpDbService.listMcpServers({
      status: req.query.status as any,
      auto_connect: req.query.auto_connect === 'true' ? true :
                    req.query.auto_connect === 'false' ? false : undefined,
      search: req.query.search as string | undefined,
      tags: tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mcp/servers
 * Register a new MCP server.
 */
router.post('/servers', async (req, res) => {
  try {
    const { name, description, transport_type, transport_config, auto_connect, metadata, tags, compile_hints, credential_providers } = req.body;
    if (!name || !transport_type || !transport_config) {
      res.status(400).json({ error: 'name, transport_type, and transport_config are required' });
      return;
    }
    const server = await mcpDbService.createMcpServer({
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
    res.status(201).json(server);
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.code === '23505') {
      res.status(409).json({ error: 'MCP server with that name already exists' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mcp/servers/test-connection
 * Test connectivity to an MCP server without persisting it.
 */
router.post('/servers/test-connection', async (req, res) => {
  try {
    const { transport_type, transport_config } = req.body;
    if (!transport_type || !transport_config) {
      res.status(400).json({ error: 'transport_type and transport_config are required' });
      return;
    }
    const { testConnection } = await import('../services/mcp/client/connection');
    const result = await testConnection(transport_type, transport_config);
    res.json(result);
  } catch (err: any) {
    res.json({ success: false, error: err.message, tools: [] });
  }
});

// ── Parameterized routes (must come after literal paths) ──────────────

/**
 * GET /api/mcp/servers/:id
 * Get a specific MCP server.
 */
router.get('/servers/:id', async (req, res) => {
  try {
    const server = await mcpDbService.getMcpServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }
    res.json(server);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/mcp/servers/:id
 * Update an MCP server registration.
 */
router.put('/servers/:id', async (req, res) => {
  try {
    const server = await mcpDbService.updateMcpServer(req.params.id, req.body);
    if (!server) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }
    res.json(server);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/mcp/servers/:id
 * Delete an MCP server registration.
 */
router.delete('/servers/:id', async (req, res) => {
  try {
    const deleted = await mcpDbService.deleteMcpServer(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Connection management ─────────────────────────────────────────────

/**
 * POST /api/mcp/servers/:id/connect
 * Connect to a registered MCP server.
 */
router.post('/servers/:id/connect', async (req, res) => {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      res.status(400).json({ error: 'MCP adapter not registered' });
      return;
    }
    await adapter.connectClient(req.params.id);
    res.json({ connected: true, serverId: req.params.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mcp/servers/:id/disconnect
 * Disconnect from a specific MCP server.
 */
router.post('/servers/:id/disconnect', async (req, res) => {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      res.status(400).json({ error: 'MCP adapter not registered' });
      return;
    }
    await adapter.disconnectClient(req.params.id);
    res.json({ disconnected: true, serverId: req.params.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Credential status ────────────────────────────────────────────────

/**
 * GET /api/mcp/servers/:id/credential-status
 * Check which credential providers are required and which the user has.
 */
router.get('/servers/:id/credential-status', async (req, res) => {
  try {
    const server = await mcpDbService.getMcpServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }
    const required: string[] = server.credential_providers ?? [];
    const registered: string[] = [];
    const missing: string[] = [];

    if (req.auth?.userId && required.length > 0) {
      const { resolveCredential } = await import('../services/iam/credentials');
      for (const provider of required) {
        const cred = await resolveCredential(
          { id: req.auth.userId, type: 'user', roles: [] },
          provider,
        );
        if (cred) registered.push(provider);
        else missing.push(provider);
      }
    } else {
      missing.push(...required);
    }

    res.json({ required, registered, missing });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tool operations ───────────────────────────────────────────────────

/**
 * GET /api/mcp/servers/:id/tools
 * List tools available on a connected MCP server.
 */
router.get('/servers/:id/tools', async (req, res) => {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      res.status(400).json({ error: 'MCP adapter not registered' });
      return;
    }
    const tools = await adapter.listTools(req.params.id);
    res.json({ tools });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/mcp/servers/:id/tools/:toolName/call
 * Call a tool on a connected MCP server.
 * Body: { arguments: { ... } }
 */
router.post('/servers/:id/tools/:toolName/call', async (req, res) => {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      res.status(400).json({ error: 'MCP adapter not registered' });
      return;
    }
    const executeAs = req.body.execute_as;
    const authContext = (executeAs || req.auth?.userId)
      ? { userId: executeAs || req.auth?.userId }
      : undefined;
    const result = await adapter.callTool(
      req.params.id,
      req.params.toolName,
      req.body.arguments || {},
      authContext,
    );
    res.json({ result });
  } catch (err: any) {
    if (err.name === 'MissingCredentialError') {
      res.status(422).json({
        error: 'missing_credential',
        provider: err.provider,
        message: err.message,
      });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
