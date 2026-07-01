import { Router } from 'express';

import * as api from '../../api/escalations';

/**
 * Parse a JSON-encoded query param (facets/block/range/exists/orderBy/roles) so the
 * full faceted query rides on a GET URL — keeps the dashboard's copy-URL/curl path
 * reproducible. Returns undefined on absent/invalid JSON (never throws to the caller).
 */
function jsonParam(v: unknown): any {
  if (typeof v !== 'string' || !v) return undefined;
  try { return JSON.parse(v); } catch { return undefined; }
}

export function registerListRoutes(router: Router): void {
  /**
   * POST /api/escalations
   * Create a standalone escalation (not tied to a workflow).
   *
   * RBAC: caller must hold the target role or be superadmin.
   *
   * Body: { type, role, subtype?, description?, priority?, envelope?,
   *         metadata?, escalation_payload? }
   */
  router.post('/', async (req, res) => {
    const result = await api.createEscalation(
      {
        type: req.body?.type,
        subtype: req.body?.subtype,
        role: req.body?.role,
        description: req.body?.description,
        priority: req.body?.priority,
        envelope: req.body?.envelope,
        metadata: req.body?.metadata,
        escalation_payload: req.body?.escalation_payload,
        // Workflow-linkage (optional): an advert for a running workflow.
        origin_id: req.body?.origin_id,
        parent_id: req.body?.parent_id,
        task_id: req.body?.task_id,
        workflow_id: req.body?.workflow_id,
        task_queue: req.body?.task_queue,
        workflow_type: req.body?.workflow_type,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations
   * List escalations with optional filters.
   * RBAC: superadmin sees all; others see only roles they belong to.
   */
  router.get('/', async (req, res) => {
    const result = await api.listEscalations(
      {
        status: req.query.status as string,
        role: req.query.role as string,
        type: req.query.type as string,
        subtype: req.query.subtype as string,
        assigned_to: req.query.assigned_to as string,
        claimed: req.query.claimed === 'true',
        priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        sort_by: req.query.sort_by as string,
        order: req.query.order as string,
        search: req.query.search as string,
        // Faceted query elements (JSON-encoded on the URL).
        roles: jsonParam(req.query.roles),
        facets: jsonParam(req.query.facets),
        block: jsonParam(req.query.block),
        range: jsonParam(req.query.range),
        exists: jsonParam(req.query.exists),
        orderBy: jsonParam(req.query.orderBy),
        available: req.query.available != null ? req.query.available === 'true' : undefined,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/available
   * List available escalations (pending, unassigned or expired claim).
   * RBAC: superadmin sees all; others see only roles they belong to.
   */
  router.get('/available', async (req, res) => {
    const result = await api.listAvailableEscalations(
      {
        role: req.query.role as string,
        type: req.query.type as string,
        subtype: req.query.subtype as string,
        priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        sort_by: req.query.sort_by as string,
        order: req.query.order as string,
        search: req.query.search as string,
        // Faceted query elements (JSON-encoded on the URL).
        roles: jsonParam(req.query.roles),
        facets: jsonParam(req.query.facets),
        block: jsonParam(req.query.block),
        range: jsonParam(req.query.range),
        exists: jsonParam(req.query.exists),
        orderBy: jsonParam(req.query.orderBy),
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/types
   * Returns distinct escalation type values.
   */
  router.get('/types', async (_req, res) => {
    const result = await api.listDistinctTypes();
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/facet-keys
   * Distinct top-level metadata facet keys visible to the caller (role-scoped).
   * Powers the faceted-query UI's key autocomplete.
   */
  router.get('/facet-keys', async (req, res) => {
    const result = await api.listFacetKeys(undefined, req.auth!);
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/station-metrics
   * Per-role P99/P50/avg/max wait + work times, resolved count, and in-arrears
   * count. Drives the COO operations membrane chart.
   * RBAC: superadmin sees all; others scoped to their roles.
   */
  router.get('/station-metrics', async (req, res) => {
    const result = await api.getStationMetrics(
      { period: (req.query.period as string) || undefined },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  /**
   * GET /api/escalations/stats
   * Aggregated escalation statistics.
   * RBAC: superadmin sees all; others scoped to their roles.
   */
  router.get('/stats', async (req, res) => {
    const result = await api.getEscalationStats(
      { period: (req.query.period as string) || undefined },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
