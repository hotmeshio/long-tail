import { Router } from 'express';

import { requireBuilder } from '../modules/auth';
import * as api from '../api/roles';
import * as escApi from '../api/escalations';
import type { FacetQuery } from '../types';

const router = Router();

/** Parse an optional JSON-encoded query param (e.g. a FacetQuery). */
function parseJsonParam(value: unknown): FacetQuery | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return JSON.parse(value) as FacetQuery;
  } catch {
    return undefined;
  }
}

/** Parse an optional integer query param (e.g. now=<epoch seconds>). */
function parseIntParam(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

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
router.post('/', requireBuilder, async (req, res) => {
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
router.post('/escalation-chains', requireBuilder, async (req, res) => {
  const { source_role, target_role } = req.body || {};
  const result = await api.addEscalationChain({ source_role, target_role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/roles/escalation-chains
 * Remove a single escalation chain entry. Requires admin.
 * Body: { source_role: string, target_role: string }
 */
router.delete('/escalation-chains', requireBuilder, async (req, res) => {
  const { source_role, target_role } = req.body || {};
  const result = await api.removeEscalationChain({ source_role, target_role });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Parameterized routes (must come AFTER named routes) ───────────────────

/**
 * GET /api/roles/:role/config
 * Read a role's self-describing config (title / purpose / metadata schema / home_view).
 */
router.get('/:role/config', async (req, res) => {
  const result = await api.getRoleConfig({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PATCH /api/roles/:role/config
 * Patch a role's config. Requires admin.
 * Body: { title?, purpose?, metadata_schema?, home_view? }
 */
router.patch('/:role/config', requireBuilder, async (req, res) => {
  const { title, purpose, metadata_schema, home_view } = req.body || {};
  const result = await api.updateRoleConfig({
    role: req.params.role as string,
    title,
    purpose,
    metadata_schema,
    home_view,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/dials
 * List a role's dials (goal rate / crew per station).
 */
router.get('/:role/dials', async (req, res) => {
  const result = await api.getRoleDials({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/roles/:role/dials/:station
 * Upsert one station's per-unit TAT target. Requires admin.
 * Body: { target_tat_seconds: number }
 */
router.put('/:role/dials/:station', requireBuilder, async (req, res) => {
  const { target_tat_seconds } = req.body || {};
  const result = await api.upsertRoleDial({
    role: req.params.role as string,
    station: req.params.station as string,
    target_tat_seconds,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/roles/:role/dials/:station
 * Remove one station's dial. Requires admin.
 */
router.delete('/:role/dials/:station', requireBuilder, async (req, res) => {
  const result = await api.deleteRoleDial({
    role: req.params.role as string,
    station: req.params.station as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/attainment
 * The role's time-series overview. The role is the pivot: this is the same
 * escalation surface, sliced by the role into an attainment series.
 * Query: range=15m|1h|1d|7d|30d, pivot=station|servicer, assignedTo, cohortBy,
 *        facet=<json FacetQuery>, now=<epoch seconds>
 */
router.get('/:role/attainment', async (req, res) => {
  const role = req.params.role as string;
  const range = req.query.range as string;
  const facet = parseJsonParam(req.query.facet);
  const nowEpoch = parseIntParam(req.query.now);

  if (req.query.pivot === 'servicer') {
    const result = await escApi.getServicerProfile(
      {
        role,
        range,
        facet,
        nowEpoch,
        assignedTo: req.query.assignedTo as string | undefined,
        cohortBy: req.query.cohortBy as string | undefined,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
    return;
  }

  const result = await escApi.getAttainment({ role, range, facet, nowEpoch }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/roles/:role/baseline
 * Freeze the current overview as an immutable baseline. RBAC: write-all/global.
 * Body: { range, label?, facet?, now? }
 */
router.post('/:role/baseline', async (req, res) => {
  const { range, label, facet, now } = req.body || {};
  const result = await escApi.setAttainmentBaseline(
    { role: req.params.role as string, range, label, facet, nowEpoch: now },
    req.auth!,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/baseline
 * The most recent saved baseline for the role.
 */
router.get('/:role/baseline', async (req, res) => {
  const result = await escApi.getAttainmentBaseline({ role: req.params.role as string }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/roles/:role/baselines
 * List the role's saved baselines (no snapshot payload).
 */
router.get('/:role/baselines', async (req, res) => {
  const result = await escApi.listAttainmentBaselines({ role: req.params.role as string }, req.auth!);
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
router.put('/:role/escalation-targets', requireBuilder, async (req, res) => {
  const { targets } = req.body || {};
  const result = await api.replaceEscalationTargets({ role: req.params.role as string, targets });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/roles/:role
 * Delete a role if it has no references. Requires admin.
 */
router.delete('/:role', requireBuilder, async (req, res) => {
  const result = await api.deleteRole({ role: req.params.role as string });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
