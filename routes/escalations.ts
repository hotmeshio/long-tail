import { Router } from 'express';

import * as escalationService from '../services/escalation';
import * as taskService from '../services/task';
import * as userService from '../services/user';
import * as roleService from '../services/role';
import { escalationStrategyRegistry } from '../services/escalation-strategy';
import { createClient, LT_TASK_QUEUE } from '../workers';

const router = Router();

/**
 * GET /api/escalations
 * List escalations with optional filters.
 * RBAC: superadmin sees all; others see only roles they belong to.
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    let visibleRoles: string[] | undefined;
    if (!isSuperAdminUser) {
      const userRoles = await userService.getUserRoles(userId);
      visibleRoles = userRoles.map((r) => r.role);
      if (visibleRoles.length === 0) {
        res.json({ escalations: [], total: 0 });
        return;
      }
    }

    const result = await escalationService.listEscalations({
      status: req.query.status as any,
      role: req.query.role as string,
      type: req.query.type as string,
      subtype: req.query.subtype as string,
      assigned_to: req.query.assigned_to as string,
      priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      sort_by: req.query.sort_by as string,
      order: req.query.order as string,
      visibleRoles,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/escalations/available
 * List available escalations (pending, unassigned or expired claim).
 * RBAC: superadmin sees all; others see only roles they belong to.
 */
router.get('/available', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    let visibleRoles: string[] | undefined;
    if (!isSuperAdminUser) {
      const userRoles = await userService.getUserRoles(userId);
      visibleRoles = userRoles.map((r) => r.role);
      if (visibleRoles.length === 0) {
        res.json({ escalations: [], total: 0 });
        return;
      }
    }

    const result = await escalationService.listAvailableEscalations({
      role: req.query.role as string,
      type: req.query.type as string,
      subtype: req.query.subtype as string,
      priority: req.query.priority ? parseInt(req.query.priority as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      sort_by: req.query.sort_by as string,
      order: req.query.order as string,
      visibleRoles,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/escalations/types
 * Returns distinct escalation type values.
 */
router.get('/types', async (_req, res) => {
  try {
    const types = await escalationService.listDistinctTypes();
    res.json({ types });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/escalations/stats
 * Aggregated escalation statistics.
 * RBAC: superadmin sees all; others scoped to their roles.
 */
router.get('/stats', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    let visibleRoles: string[] | undefined;
    if (!isSuperAdminUser) {
      const userRoles = await userService.getUserRoles(userId);
      visibleRoles = userRoles.map((r) => r.role);
      if (visibleRoles.length === 0) {
        res.json({
          pending: 0, claimed: 0,
          created: 0, resolved: 0,
          by_role: [], by_type: [],
        });
        return;
      }
    }
    const period = (req.query.period as string) || undefined;
    const stats = await escalationService.getEscalationStats(visibleRoles, period);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/release-expired
 * Optional cleanup of stale assignment data.
 */
router.post('/release-expired', async (_req, res) => {
  try {
    const released = await escalationService.releaseExpiredClaims();
    res.json({ released });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/escalations/priority
 * Bulk update priority for selected escalations.
 * Body: { ids: string[], priority: 1|2|3|4 }
 * Requires admin/superadmin permission for the escalation roles.
 */
router.patch('/priority', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { ids, priority } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' });
      return;
    }
    if (![1, 2, 3, 4].includes(priority)) {
      res.status(400).json({ error: 'priority must be 1, 2, 3, or 4' });
      return;
    }

    // Permission check: superadmin can update any; admin only for their roles
    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    if (!isSuperAdminUser) {
      const roles = await escalationService.getEscalationRoles(ids);
      for (const role of roles) {
        const canManage = await userService.isGroupAdmin(userId, role);
        if (!canManage) {
          res.status(403).json({
            error: `Insufficient permissions for role "${role}"`,
          });
          return;
        }
      }
    }

    const updated = await escalationService.updateEscalationsPriority(ids, priority);
    res.json({ updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/bulk-claim
 * Bulk claim selected escalations for the authenticated user.
 * Body: { ids: string[], durationMinutes?: number }
 */
router.post('/bulk-claim', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { ids, durationMinutes } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' });
      return;
    }

    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    if (!isSuperAdminUser) {
      const roles = await escalationService.getEscalationRoles(ids);
      for (const role of roles) {
        const canManage = await userService.isGroupAdmin(userId, role);
        if (!canManage) {
          res.status(403).json({ error: `Insufficient permissions for role "${role}"` });
          return;
        }
      }
    }

    const result = await escalationService.bulkClaimEscalations(
      ids,
      userId,
      durationMinutes ?? 30,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/bulk-assign
 * Bulk assign selected escalations to a specific user.
 * Body: { ids: string[], targetUserId: string, durationMinutes?: number }
 * Superadmin: can assign anyone. Admin: target must hold escalation role.
 */
router.post('/bulk-assign', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { ids, targetUserId, durationMinutes } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' });
      return;
    }
    if (!targetUserId || typeof targetUserId !== 'string') {
      res.status(400).json({ error: 'targetUserId is required' });
      return;
    }

    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    const roles = await escalationService.getEscalationRoles(ids);

    if (!isSuperAdminUser) {
      // Caller must be group admin for each escalation's role
      for (const role of roles) {
        const canManage = await userService.isGroupAdmin(userId, role);
        if (!canManage) {
          res.status(403).json({ error: `Insufficient permissions for role "${role}"` });
          return;
        }
      }
      // Target user must hold each escalation's role
      for (const role of roles) {
        const targetHasRole = await userService.hasRole(targetUserId, role);
        if (!targetHasRole) {
          res.status(400).json({ error: `Target user does not hold the "${role}" role` });
          return;
        }
      }
    }

    const result = await escalationService.bulkAssignEscalations(
      ids,
      targetUserId,
      durationMinutes ?? 30,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/escalations/bulk-escalate
 * Bulk reassign selected escalations to a different role.
 * Body: { ids: string[], targetRole: string }
 */
router.patch('/bulk-escalate', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { ids, targetRole } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' });
      return;
    }
    if (!targetRole || typeof targetRole !== 'string') {
      res.status(400).json({ error: 'targetRole is required' });
      return;
    }

    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    if (!isSuperAdminUser) {
      const roles = await escalationService.getEscalationRoles(ids);
      for (const role of roles) {
        const canManage = await userService.isGroupAdmin(userId, role);
        if (!canManage) {
          res.status(403).json({ error: `Insufficient permissions for role "${role}"` });
          return;
        }
      }
    }

    const updated = await escalationService.bulkEscalateToRole(ids, targetRole);
    res.json({ updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/bulk-triage
 * Bulk resolve selected escalations and start AI triage workflows.
 * Body: { ids: string[], hint?: string }
 */
router.post('/bulk-triage', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { ids, hint } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' });
      return;
    }

    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    if (!isSuperAdminUser) {
      const roles = await escalationService.getEscalationRoles(ids);
      for (const role of roles) {
        const canManage = await userService.isGroupAdmin(userId, role);
        if (!canManage) {
          res.status(403).json({ error: `Insufficient permissions for role "${role}"` });
          return;
        }
      }
    }

    const resolved = await escalationService.bulkResolveForTriage(ids, hint);
    const client = createClient();
    const workflowIds: string[] = [];

    for (const escalation of resolved) {
      let escalationPayload: Record<string, any> = {};
      if (escalation.escalation_payload) {
        try { escalationPayload = JSON.parse(escalation.escalation_payload as string); } catch {}
      }

      let envelope: Record<string, any> = {};
      if (escalation.envelope) {
        try { envelope = JSON.parse(escalation.envelope as string); } catch {}
      }

      const triageWorkflowId = `triage-${escalation.id}-${Date.now()}`;

      const triageEnvelope = {
        data: {
          escalationId: escalation.id,
          originId: escalation.origin_id,
          originalWorkflowType: escalation.workflow_type,
          originalTaskQueue: escalation.task_queue,
          originalTaskId: escalation.task_id,
          escalationPayload,
          resolverPayload: {
            _lt: { needsTriage: true, ...(hint ? { hint } : {}) },
          },
        },
        metadata: envelope.metadata || {},
        lt: envelope.lt || {},
      };

      const routing = escalation.task_id
        ? ((await taskService.getTask(escalation.task_id))?.metadata as Record<string, any> | null)
        : null;

      await taskService.createTask({
        workflow_id: triageWorkflowId,
        workflow_type: 'mcpTriageOrchestrator',
        lt_type: 'mcpTriageOrchestrator',
        task_queue: 'lt-mcp-triage-orch',
        signal_id: `lt-triage-${triageWorkflowId}`,
        parent_workflow_id: routing?.parentWorkflowId || triageWorkflowId,
        origin_id: escalation.origin_id || triageWorkflowId,
        parent_id: escalation.parent_id ?? undefined,
        envelope: JSON.stringify(triageEnvelope),
        metadata: routing || undefined,
      });

      await client.workflow.start({
        workflowName: 'mcpTriageOrchestrator',
        args: [triageEnvelope],
        taskQueue: 'lt-mcp-triage-orch',
        workflowId: triageWorkflowId,
        expire: 300,
      });

      workflowIds.push(triageWorkflowId);
    }

    res.json({ triaged: resolved.length, workflows: workflowIds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/escalations/:id/escalate
 * Reassign an escalation to a different role.
 * Body: { targetRole: string }
 */
router.patch('/:id/escalate', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { targetRole } = req.body || {};

    if (!targetRole || typeof targetRole !== 'string') {
      res.status(400).json({ error: 'targetRole is required' });
      return;
    }

    const escalation = await escalationService.getEscalation(req.params.id);
    if (!escalation) {
      res.status(404).json({ error: 'Escalation not found' });
      return;
    }
    if (escalation.status !== 'pending') {
      res.status(409).json({ error: 'Escalation is not pending' });
      return;
    }

    // Authorization: user must be able to escalate from current role to target role
    const canEscalate = await roleService.canEscalateTo(userId, escalation.role, targetRole);
    if (!canEscalate) {
      res.status(403).json({ error: 'Not authorized to escalate to this role' });
      return;
    }

    const updated = await escalationService.escalateToRole(req.params.id, targetRole);
    if (!updated) {
      res.status(409).json({ error: 'Escalation could not be updated' });
      return;
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/escalations/by-workflow/:workflowId
 * List escalations linked to a specific workflow.
 */
router.get('/by-workflow/:workflowId', async (req, res) => {
  try {
    const escalations = await escalationService.getEscalationsByWorkflowId(
      req.params.workflowId,
    );
    res.json({ escalations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Parameterized routes (must come after literal paths) ─────────────────────

/**
 * GET /api/escalations/:id
 * Get a single escalation by ID.
 * RBAC: superadmin sees all; others must hold the escalation's role.
 */
router.get('/:id', async (req, res) => {
  try {
    const escalation = await escalationService.getEscalation(req.params.id);
    if (!escalation) {
      res.status(404).json({ error: 'Escalation not found' });
      return;
    }

    const userId = req.auth!.userId;
    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    if (!isSuperAdminUser) {
      const userHasRole = await userService.hasRole(userId, escalation.role);
      if (!userHasRole) {
        res.status(403).json({ error: 'Not authorized to view this escalation' });
        return;
      }
    }

    res.json(escalation);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/:id/claim
 * Claim an escalation. userId comes from auth token.
 * Body: { durationMinutes?: number }
 */
router.post('/:id/claim', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { durationMinutes } = req.body || {};

    // Role check: user must hold the escalation's role or be superadmin
    const escalation = await escalationService.getEscalation(req.params.id);
    if (!escalation) {
      res.status(404).json({ error: 'Escalation not found' });
      return;
    }
    const isSuperAdminUser = await userService.isSuperAdmin(userId);
    if (!isSuperAdminUser) {
      const userHasRole = await userService.hasRole(userId, escalation.role);
      if (!userHasRole) {
        res.status(403).json({ error: `You must have the "${escalation.role}" role to claim this escalation` });
        return;
      }
    }

    const result = await escalationService.claimEscalation(
      req.params.id,
      userId,
      durationMinutes,
    );

    if (!result) {
      res.status(409).json({ error: 'Escalation not available for claim' });
      return;
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/:id/release
 * Release a claimed escalation back to the available pool.
 * Only the assigned user may release their own claim.
 */
router.post('/:id/release', async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const result = await escalationService.releaseEscalation(req.params.id, userId);

    if (!result) {
      res.status(409).json({ error: 'Escalation not found or not claimed by you' });
      return;
    }

    res.json({ escalation: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/escalations/:id/resolve
 * Start a new workflow with resolver data to re-run the failed step.
 * The interceptor in the new workflow resolves the escalation record
 * and signals back to the orchestrator (if any) on success.
 * Body: { resolverPayload: Record<string, any> }
 */
router.post('/:id/resolve', async (req, res) => {
  try {
    const { resolverPayload } = req.body || {};
    if (!resolverPayload) {
      res.status(400).json({ error: 'resolverPayload is required' });
      return;
    }

    // 1. Read escalation (verify pending)
    const escalation = await escalationService.getEscalation(req.params.id);
    if (!escalation) {
      res.status(404).json({ error: 'Escalation not found' });
      return;
    }
    if (escalation.status !== 'pending') {
      res.status(409).json({ error: 'Escalation not available for resolution' });
      return;
    }

    // 2. Reconstruct the original envelope from the escalation or task
    let envelope: Record<string, any> = {};
    if (escalation.envelope) {
      try {
        envelope = JSON.parse(escalation.envelope);
      } catch { /* use empty */ }
    } else if (escalation.task_id) {
      const task = await taskService.getTask(escalation.task_id);
      if (task?.envelope) {
        try {
          envelope = JSON.parse(task.envelope);
        } catch { /* use empty */ }
      }
    }

    // 3. Check escalation strategy for triage routing
    const strategy = escalationStrategyRegistry.current;
    if (strategy) {
      const directive = await strategy.onResolution({
        escalation,
        resolverPayload,
        envelope,
      });

      if (directive.action === 'triage') {
        // Route to MCP triage orchestrator instead of standard re-run
        const originalTask = escalation.task_id
          ? await taskService.getTask(escalation.task_id)
          : null;
        const routing = originalTask?.metadata as Record<string, any> | null;

        const triageWorkflowId = `triage-${escalation.id}-${Date.now()}`;
        const client = createClient();

        await taskService.createTask({
          workflow_id: triageWorkflowId,
          workflow_type: 'mcpTriageOrchestrator',
          lt_type: 'mcpTriageOrchestrator',
          task_queue: 'lt-mcp-triage-orch',
          signal_id: `lt-triage-${triageWorkflowId}`,
          parent_workflow_id: routing?.parentWorkflowId || triageWorkflowId,
          origin_id: escalation.origin_id || triageWorkflowId,
          parent_id: escalation.parent_id ?? undefined,
          envelope: JSON.stringify(directive.triageEnvelope),
          metadata: routing || undefined,
        });

        await client.workflow.start({
          workflowName: 'mcpTriageOrchestrator',
          args: [directive.triageEnvelope],
          taskQueue: 'lt-mcp-triage-orch',
          workflowId: triageWorkflowId,
          expire: 300,
        });

        // Mark escalation as resolved (triage is handling it)
        await escalationService.resolveEscalation(escalation.id, {
          ...resolverPayload,
          _lt: { ...resolverPayload._lt, triaged: true, triageWorkflowId },
        });

        res.json({
          started: true,
          escalationId: escalation.id,
          workflowId: triageWorkflowId,
          triage: true,
        });
        return;
      }
    }

    // 4. If no workflow_type, this is a notification-only escalation — acknowledge and close
    if (!escalation.workflow_type || !escalation.task_queue) {
      await escalationService.resolveEscalation(escalation.id, resolverPayload);
      res.json({ acknowledged: true, escalationId: escalation.id });
      return;
    }

    // 5. Standard re-run: inject resolver data and start original workflow
    envelope.resolver = resolverPayload;
    envelope.lt = {
      ...envelope.lt,
      escalationId: escalation.id,
    };

    const newWorkflowId = `rerun-${escalation.id}-${Date.now()}`;
    const client = createClient();

    await client.workflow.start({
      workflowName: escalation.workflow_type,
      args: [envelope],
      taskQueue: escalation.task_queue,
      workflowId: newWorkflowId,
      expire: 180,
    });

    res.json({ started: true, escalationId: escalation.id, workflowId: newWorkflowId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
