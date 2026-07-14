import { Router } from 'express';

import { requireRoleManager } from '../modules/auth';
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
router.post('/', requireRoleManager, async (req, res) => {
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
router.post('/escalation-chains', requireRoleManager, async (req, res) => {
  const { source_role, target_role } = req.body || {};
  const result = await api.addEscalationChain({ source_role, target_role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/roles/escalation-chains
 * Remove a single escalation chain entry. Requires admin.
 * Body: { source_role: string, target_role: string }
 */
router.delete('/escalation-chains', requireRoleManager, async (req, res) => {
  const { source_role, target_role } = req.body || {};
  const result = await api.removeEscalationChain({ source_role, target_role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Parameterized routes (must come AFTER named routes) ───────────────────

/**
 * PATCH /api/roles/:role
 * Update role metadata. Requires admin.
 * Body: { title?, description?, form_schema?, metadata_schema?, properties?, ops_visible?, parent_role?, sla_minutes?, target_per_hour?, worker_count?, priority_threshold_minutes?, priority_facet? }
 */
router.patch('/:role', requireRoleManager, async (req, res) => {
  // URL is the resource identity — a `role` key in the body must not redirect
  // the write to a different row.
  const result = await api.updateRole({ ...req.body, role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/schema
 * Fetch the role's schema pair. `?version=N` pins an immutable snapshot from
 * the version history; omitted, the live (latest) schema is returned with its
 * current version number.
 */
router.get('/:role/schema', async (req, res) => {
  const versionParam = req.query.version as string | undefined;
  const version = versionParam !== undefined ? Number(versionParam) : undefined;
  const result = await api.getRoleSchema({ role: req.params.role as string, version });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/schema/versions
 * List the role's schema version history (newest first).
 */
router.get('/:role/schema/versions', async (req, res) => {
  const result = await api.listRoleSchemaVersions({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/list-schema
 * Fetch the role's LIST schema (rich list-page formatting). `?version=N` pins a
 * snapshot; omitted, the live (latest) list schema is returned with its version.
 * Versions independently from the resolve form schema.
 */
router.get('/:role/list-schema', async (req, res) => {
  const versionParam = req.query.version as string | undefined;
  const version = versionParam !== undefined ? Number(versionParam) : undefined;
  const result = await api.getRoleListSchema({ role: req.params.role as string, version });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/list-schema/versions
 * List the role's LIST schema version history (newest first).
 */
router.get('/:role/list-schema/versions', async (req, res) => {
  const result = await api.listRoleListSchemaVersions({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

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
router.put('/:role/escalation-targets', requireRoleManager, async (req, res) => {
  const { targets } = req.body || {};
  const result = await api.replaceEscalationTargets({ role: req.params.role as string, targets });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/roles/:role
 * Delete a role if it has no references. Requires admin.
 */
router.delete('/:role', requireRoleManager, async (req, res) => {
  const result = await api.deleteRole({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
