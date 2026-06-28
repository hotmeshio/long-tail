import { Router } from 'express';

import { requireAdmin, requireBuilder } from '../modules/auth';
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
router.post('/', requireBuilder, async (req, res) => {
  const result = await api.createUser(req.body || {});
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/users/:id
 * Update a user. Builder only.
 * Body: { email?, display_name?, status?, metadata? }
 */
router.put('/:id', requireBuilder, async (req, res) => {
  const result = await api.updateUser({ id: req.params.id as string, ...(req.body || {}) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/users/:id
 * Delete a user. Builder only.
 */
router.delete('/:id', requireBuilder, async (req, res) => {
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
 * Body: { role, type, read_scope?, write_scope? } — type must be superadmin,
 * admin, or member. read_scope (self|all) and write_scope (none|self|all) refine
 * a member's work surface; they default to all/all and are ignored for admin/superadmin.
 *
 * Scoping rules (management tier):
 * - superadmin: can assign any role/type
 * - engineer: can assign up to admin type, but never superadmin type
 * - role/admin (non-builder): can only assign member/admin for roles they hold
 * A caller who may assign a role may set any work-surface scope on it.
 */
router.post('/:id/roles', requireAdmin, async (req, res) => {
  const { role, type, read_scope, write_scope } = req.body || {};
  const userId = req.auth!.userId;

  // Superadmin bypasses all scoping
  const { isSuperAdmin } = await import('../services/user/rbac');
  if (!(await isSuperAdmin(userId))) {
    // Non-superadmin can never assign superadmin type
    if (type === 'superadmin') {
      res.status(403).json({ error: 'Only superadmin can assign superadmin role type' });
      return;
    }

    // Check if caller has the engineer role (builder) — can assign any non-superadmin role
    const { hasRole: checkRole } = await import('../services/user/roles');
    const isEngineer = await checkRole(userId, 'engineer');

    if (!isEngineer) {
      // Non-builder admin: can only assign roles they themselves hold
      const callerHasRole = await checkRole(userId, role);
      if (!callerHasRole) {
        res.status(403).json({ error: `You can only assign roles you hold. You do not have the '${role}' role.` });
        return;
      }
    }
  }

  const result = await api.addUserRole({ id: req.params.id as string, role, type, read_scope, write_scope });
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
