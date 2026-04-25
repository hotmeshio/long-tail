import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as api from '../api/roles';

const router = Router();

/**
 * GET /api/roles
 * List all distinct roles known to the system.
 */
router.get('/', async (_req, res) => {
  const result = await api.listRoles();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/details
 * List all roles with usage counts.
 */
router.get('/details', async (_req, res) => {
  const result = await api.listRolesWithDetails();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/roles
 * Create a standalone role. Requires admin.
 * Body: { role: string }
 */
router.post('/', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  const result = await api.createRole({ role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/escalation-chains
 * Get all escalation chain pairs.
 */
router.get('/escalation-chains', async (_req, res) => {
  const result = await api.getEscalationChains();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/roles/escalation-chains
 * Add a single escalation chain entry. Requires admin.
 * Body: { source_role: string, target_role: string }
 */
router.post('/escalation-chains', requireAdmin, async (req, res) => {
  const { source_role, target_role } = req.body || {};
  const result = await api.addEscalationChain({ source_role, target_role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/roles/escalation-chains
 * Remove a single escalation chain entry. Requires admin.
 * Body: { source_role: string, target_role: string }
 */
router.delete('/escalation-chains', requireAdmin, async (req, res) => {
  const { source_role, target_role } = req.body || {};
  const result = await api.removeEscalationChain({ source_role, target_role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Parameterized routes (must come AFTER named routes) ───────────────────

/**
 * GET /api/roles/:role/escalation-targets
 * Get allowed escalation targets for a specific role.
 */
router.get('/:role/escalation-targets', async (req, res) => {
  const result = await api.getEscalationTargets({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/roles/:role/escalation-targets
 * Replace escalation targets for a role. Requires admin.
 * Body: { targets: string[] }
 */
router.put('/:role/escalation-targets', requireAdmin, async (req, res) => {
  const { targets } = req.body || {};
  const result = await api.replaceEscalationTargets({ role: req.params.role as string, targets });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/roles/:role
 * Delete a role if it has no references. Requires admin.
 */
router.delete('/:role', requireAdmin, async (req, res) => {
  const result = await api.deleteRole({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
