import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as iam from '../services/iam';
import { isValidRoleType } from '../services/user';

const router = Router();

// All bot account routes require admin access
router.use(requireAdmin);

// ── Bot CRUD ─────────────────────────────────────────────────────────────────

/**
 * GET /api/bot-accounts
 * List all bot accounts.
 * Query: ?limit=50&offset=0
 */
router.get('/', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const result = await iam.listBots(limit, offset);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bot-accounts/:id
 * Get a single bot account.
 */
router.get('/:id', async (req, res) => {
  try {
    const bot = await iam.getBot(req.params.id);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json(bot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bot-accounts
 * Create a new bot account.
 * Body: { name, description?, display_name?, roles?: [{ role, type }] }
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, display_name, roles } = req.body || {};
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (roles) {
      for (const r of roles) {
        if (!r.role || !r.type || !isValidRoleType(r.type)) {
          res.status(400).json({
            error: 'Each role must have a role name and type (superadmin, admin, member)',
          });
          return;
        }
      }
    }
    const bot = await iam.createBot({
      name,
      description,
      display_name,
      roles,
      created_by: req.auth?.userId,
    });
    res.status(201).json(bot);
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Bot with this name already exists' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/bot-accounts/:id
 * Update a bot account.
 * Body: { display_name?, description?, status? }
 */
router.put('/:id', async (req, res) => {
  try {
    const bot = await iam.updateBot(req.params.id, req.body || {});
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json(bot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bot-accounts/:id
 * Delete a bot account.
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await iam.deleteBot(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bot roles ────────────────────────────────────────────────────────────────

/**
 * GET /api/bot-accounts/:id/roles
 * List roles for a bot.
 */
router.get('/:id/roles', async (req, res) => {
  try {
    const bot = await iam.getBot(req.params.id);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const roles = await iam.getBotRoles(req.params.id);
    res.json({ roles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bot-accounts/:id/roles
 * Add a role to a bot.
 * Body: { role, type }
 */
router.post('/:id/roles', async (req, res) => {
  try {
    const { role, type } = req.body || {};
    if (!role || !type) {
      res.status(400).json({ error: 'role and type are required' });
      return;
    }
    if (!isValidRoleType(type)) {
      res.status(400).json({ error: 'type must be superadmin, admin, or member' });
      return;
    }
    const bot = await iam.getBot(req.params.id);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const result = await iam.addBotRole(req.params.id, role, type);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bot-accounts/:id/roles/:role
 * Remove a role from a bot.
 */
router.delete('/:id/roles/:role', async (req, res) => {
  try {
    const removed = await iam.removeBotRole(req.params.id, req.params.role);
    if (!removed) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    res.json({ removed: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── API keys ─────────────────────────────────────────────────────────────────

/**
 * GET /api/bot-accounts/:id/api-keys
 * List API keys for a bot (without secret values).
 */
router.get('/:id/api-keys', async (req, res) => {
  try {
    const bot = await iam.getBot(req.params.id);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const keys = await iam.listBotKeys(req.params.id);
    res.json({ keys });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bot-accounts/:id/api-keys
 * Generate a new API key for a bot.
 * Body: { name, scopes?: string[], expires_at?: string }
 * Returns the raw key ONCE — it cannot be retrieved again.
 */
router.post('/:id/api-keys', async (req, res) => {
  try {
    const { name, scopes, expires_at } = req.body || {};
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const expiresAt = expires_at ? new Date(expires_at) : undefined;
    const result = await iam.createBotKey(
      req.params.id,
      name,
      scopes || [],
      expiresAt,
    );
    res.status(201).json(result);
  } catch (err: any) {
    if (err.message === 'Bot not found') {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.code === '23505') {
      res.status(409).json({ error: 'API key with this name already exists for this bot' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bot-accounts/:id/api-keys/:keyId
 * Revoke (delete) a bot API key.
 */
router.delete('/:id/api-keys/:keyId', async (req, res) => {
  try {
    const revoked = await iam.revokeBotKey(req.params.keyId);
    if (!revoked) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }
    res.json({ revoked: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
