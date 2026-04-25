import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as api from '../api/users';

const router = Router();

// ── User CRUD ─────────────────────────────────────────────────────────────────

/**
 * GET /api/users
 * List users with optional filters.
 * Query: ?role=reviewer&roleType=admin&status=active&limit=50&offset=0
 */
router.get('/', async (req, res) => {
  const result = await api.listUsers({
    role: req.query.role as string,
    roleType: req.query.roleType as any,
    status: req.query.status as any,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/users/:id
 * Get a single user by ID.
 */
router.get('/:id', async (req, res) => {
  const result = await api.getUser({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/users
 * Create a new user.
 * Body: { external_id, email?, display_name?, roles?: [{ role, type }], metadata? }
 */
router.post('/', requireAdmin, async (req, res) => {
  const result = await api.createUser(req.body || {});
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/users/:id
 * Update a user.
 * Body: { email?, display_name?, status?, metadata? }
 */
router.put('/:id', requireAdmin, async (req, res) => {
  const result = await api.updateUser({ id: req.params.id as string, ...(req.body || {}) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/users/:id
 * Delete a user.
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  const result = await api.deleteUser({ id: req.params.id as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Role management ─────────────────────────────────────────────────────────

/**
 * GET /api/users/:id/roles
 * Get all roles for a user.
 */
router.get('/:id/roles', async (req, res) => {
  const result = await api.getUserRoles({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/users/:id/roles
 * Add a role to a user.
 * Body: { role, type } — type must be superadmin, admin, or member
 */
router.post('/:id/roles', requireAdmin, async (req, res) => {
  const { role, type } = req.body || {};
  const result = await api.addUserRole({ id: req.params.id as string, role, type });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/users/:id/roles/:role
 * Remove a role from a user.
 */
router.delete('/:id/roles/:role', requireAdmin, async (req, res) => {
  const result = await api.removeUserRole({ id: req.params.id as string, role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
