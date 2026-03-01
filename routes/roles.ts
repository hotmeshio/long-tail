import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as roleService from '../services/role';

const router = Router();

/**
 * GET /api/roles
 * List all distinct roles known to the system.
 */
router.get('/', async (_req, res) => {
  try {
    const roles = await roleService.listDistinctRoles();
    res.json({ roles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/roles/escalation-chains
 * Get all escalation chain pairs.
 */
router.get('/escalation-chains', async (_req, res) => {
  try {
    const chains = await roleService.getAllEscalationChains();
    res.json({ chains });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/roles/escalation-chains
 * Add a single escalation chain entry. Requires admin.
 * Body: { source_role: string, target_role: string }
 */
router.post('/escalation-chains', requireAdmin, async (req, res) => {
  try {
    const { source_role, target_role } = req.body || {};
    if (!source_role || !target_role) {
      res.status(400).json({ error: 'source_role and target_role are required' });
      return;
    }
    await roleService.addEscalationChain(source_role, target_role);
    res.status(201).json({ source_role, target_role });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/roles/escalation-chains
 * Remove a single escalation chain entry. Requires admin.
 * Body: { source_role: string, target_role: string }
 */
router.delete('/escalation-chains', requireAdmin, async (req, res) => {
  try {
    const { source_role, target_role } = req.body || {};
    if (!source_role || !target_role) {
      res.status(400).json({ error: 'source_role and target_role are required' });
      return;
    }
    const removed = await roleService.removeEscalationChain(source_role, target_role);
    if (!removed) {
      res.status(404).json({ error: 'Chain entry not found' });
      return;
    }
    res.json({ removed: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/roles/:role/escalation-targets
 * Get allowed escalation targets for a specific role.
 */
router.get('/:role/escalation-targets', async (req, res) => {
  try {
    const targets = await roleService.getEscalationTargets(req.params.role);
    res.json({ targets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/roles/:role/escalation-targets
 * Replace escalation targets for a role. Requires admin.
 * Body: { targets: string[] }
 */
router.put('/:role/escalation-targets', requireAdmin, async (req, res) => {
  try {
    const { targets } = req.body || {};
    if (!Array.isArray(targets)) {
      res.status(400).json({ error: 'targets must be an array of strings' });
      return;
    }
    await roleService.replaceEscalationTargets(req.params.role as string, targets);
    res.json({ role: req.params.role as string, targets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
