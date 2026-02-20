import { Router } from 'express';

import * as userService from '../services/user';

const router = Router();

/**
 * GET /api/users
 * List users with optional filters.
 * Query: ?role=admin&roleType=admin&status=active&limit=50&offset=0
 */
router.get('/', async (req, res) => {
  try {
    const result = await userService.listUsers({
      role: req.query.role as string,
      roleType: req.query.roleType as string,
      status: req.query.status as any,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/:id
 * Get a single user by ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await userService.getUser(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/users
 * Create a new user.
 * Body: { external_id, email?, display_name?, roles?: [{ role, type }], metadata? }
 */
router.post('/', async (req, res) => {
  try {
    const { external_id, email, display_name, roles, metadata } = req.body || {};
    if (!external_id) {
      res.status(400).json({ error: 'external_id is required' });
      return;
    }
    const user = await userService.createUser({
      external_id,
      email,
      display_name,
      roles,
      metadata,
    });
    res.status(201).json(user);
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'User with this external_id already exists' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/users/:id
 * Update a user.
 * Body: { email?, display_name?, status?, metadata? }
 */
router.put('/:id', async (req, res) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body || {});
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/users/:id
 * Delete a user.
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await userService.deleteUser(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Role sub-routes ─────────────────────────────────────────────────────────

/**
 * GET /api/users/:id/roles
 * Get all roles for a user.
 */
router.get('/:id/roles', async (req, res) => {
  try {
    const roles = await userService.getUserRoles(req.params.id);
    res.json({ roles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/users/:id/roles
 * Add a role to a user.
 * Body: { role, type }
 */
router.post('/:id/roles', async (req, res) => {
  try {
    const { role, type } = req.body || {};
    if (!role || !type) {
      res.status(400).json({ error: 'role and type are required' });
      return;
    }
    const result = await userService.addUserRole(req.params.id, role, type);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/users/:id/roles/:role
 * Remove a role from a user.
 */
router.delete('/:id/roles/:role', async (req, res) => {
  try {
    const removed = await userService.removeUserRole(req.params.id, req.params.role);
    if (!removed) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    res.json({ removed: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
