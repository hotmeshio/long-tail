import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as api from '../api/bot-accounts';

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
  const result = await api.listBots({
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/bot-accounts/:id
 * Get a single bot account.
 */
router.get('/:id', async (req, res) => {
  const result = await api.getBot({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/bot-accounts
 * Create a new bot account.
 * Body: { name, description?, display_name?, roles?: [{ role, type }] }
 */
router.post('/', async (req, res) => {
  const { name, description, display_name, roles } = req.body || {};
  const result = await api.createBot(
    { name, description, display_name, roles },
    req.auth ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/bot-accounts/:id
 * Update a bot account.
 * Body: { display_name?, description?, status? }
 */
router.put('/:id', async (req, res) => {
  const result = await api.updateBot({ id: req.params.id, ...(req.body || {}) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/bot-accounts/:id
 * Delete a bot account.
 */
router.delete('/:id', async (req, res) => {
  const result = await api.deleteBot({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Bot roles ────────────────────────────────────────────────────────────────

/**
 * GET /api/bot-accounts/:id/roles
 * List roles for a bot.
 */
router.get('/:id/roles', async (req, res) => {
  const result = await api.getBotRoles({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/bot-accounts/:id/roles
 * Add a role to a bot.
 * Body: { role, type }
 */
router.post('/:id/roles', async (req, res) => {
  const { role, type } = req.body || {};
  const result = await api.addBotRole({ id: req.params.id, role, type });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/bot-accounts/:id/roles/:role
 * Remove a role from a bot.
 */
router.delete('/:id/roles/:role', async (req, res) => {
  const result = await api.removeBotRole({ id: req.params.id, role: req.params.role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── API keys ─────────────────────────────────────────────────────────────────

/**
 * GET /api/bot-accounts/:id/api-keys
 * List API keys for a bot (without secret values).
 */
router.get('/:id/api-keys', async (req, res) => {
  const result = await api.listBotKeys({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/bot-accounts/:id/api-keys
 * Generate a new API key for a bot.
 * Body: { name, scopes?: string[], expires_at?: string }
 * Returns the raw key ONCE — it cannot be retrieved again.
 */
router.post('/:id/api-keys', async (req, res) => {
  const { name, scopes, expires_at } = req.body || {};
  const result = await api.createBotKey({
    id: req.params.id,
    name,
    scopes,
    expires_at,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/bot-accounts/:id/api-keys/:keyId
 * Revoke (delete) a bot API key.
 */
router.delete('/:id/api-keys/:keyId', async (req, res) => {
  const result = await api.revokeBotKey({ keyId: req.params.keyId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
