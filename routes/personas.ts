import { Router } from 'express';

import { requireRoleManager } from '../modules/auth';
import * as api from '../api/personas';

const router = Router();

// Personas are role bundles — a management surface. Reads and writes share the
// role-management gate (admin type, superadmin, engineer), the same audience
// that manages roles and users.
router.use(requireRoleManager);

/**
 * GET /api/personas
 * List all personas with role links and holder counts.
 */
router.get('/', async (_req, res) => {
  const result = await api.listPersonas();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/personas
 * Create a persona.
 * Body: { key, title?, description? }
 */
router.post('/', async (req, res) => {
  const result = await api.createPersona(req.body || {});
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/personas/seed
 * Declarative, idempotent seed — upsert personas, sync role links, reconcile holders.
 * Body: { personas: [{ key, title?, description?, roles: [{ role, relationship }] }] }
 */
router.post('/seed', async (req, res) => {
  const result = await api.seedPersonas(req.body || {});
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/personas/:key
 * Get one persona with role links and assignees.
 */
router.get('/:key', async (req, res) => {
  const result = await api.getPersona({ key: req.params.key as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PATCH /api/personas/:key
 * Update title/description (PATCH semantics; null clears).
 */
router.patch('/:key', async (req, res) => {
  const result = await api.updatePersona({ key: req.params.key as string, ...(req.body || {}) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/personas/:key
 * Delete a persona. Sustained memberships are removed or re-homed; direct grants untouched.
 */
router.delete('/:key', async (req, res) => {
  const result = await api.deletePersona({ key: req.params.key as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/personas/:key/roles/:role
 * Link a role (or change its relationship).
 * Body: { relationship: 'write-all' | 'write-self' | 'read-all' } ('write-none' = read-all)
 */
router.put('/:key/roles/:role', async (req, res) => {
  const result = await api.linkPersonaRole({
    key: req.params.key as string,
    role: req.params.role as string,
    relationship: (req.body || {}).relationship,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/personas/:key/roles/:role
 * Unlink a role from a persona.
 */
router.delete('/:key/roles/:role', async (req, res) => {
  const result = await api.unlinkPersonaRole({
    key: req.params.key as string,
    role: req.params.role as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
