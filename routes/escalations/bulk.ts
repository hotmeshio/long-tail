import { Router } from 'express';

import * as escalationService from '../../services/escalation';
import * as taskService from '../../services/task';
import * as userService from '../../services/user';
import { createClient, LT_TASK_QUEUE } from '../../workers';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { publishEscalationEvent } from '../../services/events/publish';

export function registerBulkRoutes(router: Router): void {
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

      if (result.claimed > 0) {
        for (const id of ids) {
          publishEscalationEvent({
            type: 'escalation.claimed',
            source: 'api',
            workflowId: '',
            workflowName: '',
            taskQueue: '',
            escalationId: id,
            status: 'claimed',
            data: { assigned_to: userId, bulk: true },
          });
        }
      }
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

      if (result.assigned > 0) {
        for (const id of ids) {
          publishEscalationEvent({
            type: 'escalation.claimed',
            source: 'api',
            workflowId: '',
            workflowName: '',
            taskQueue: '',
            escalationId: id,
            status: 'claimed',
            data: { assigned_to: targetUserId, bulk: true },
          });
        }
      }
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
            originId: escalation.origin_id ?? undefined,
            originalWorkflowType: escalation.workflow_type,
            originalTaskQueue: escalation.task_queue,
            originalTaskId: escalation.task_id,
            escalationPayload,
            resolverPayload: {
              _lt: { needsTriage: true, ...(hint ? { hint } : {}) },
            },
          },
          metadata: envelope.metadata || {},
          lt: { ...(envelope.lt || {}), userId: req.auth?.userId },
        };

        const routing = escalation.task_id
          ? ((await taskService.getTask(escalation.task_id))?.metadata as Record<string, any> | null)
          : null;

        await taskService.createTask({
          workflow_id: triageWorkflowId,
          workflow_type: 'mcpTriage',
          lt_type: 'mcpTriage',
          task_queue: 'long-tail-system',
          signal_id: `lt-triage-${triageWorkflowId}`,
          parent_workflow_id: routing?.parentWorkflowId || triageWorkflowId,
          origin_id: escalation.origin_id || triageWorkflowId,
          parent_id: escalation.parent_id ?? undefined,
          envelope: JSON.stringify(triageEnvelope),
          metadata: routing || undefined,
        });

        await client.workflow.start({
          workflowName: 'mcpTriage',
          args: [triageEnvelope],
          taskQueue: 'long-tail-system',
          workflowId: triageWorkflowId,
          expire: JOB_EXPIRE_SECS,
          entity: 'mcpTriage',
        } as any);

        workflowIds.push(triageWorkflowId);
      }

      res.json({ triaged: resolved.length, workflows: workflowIds });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
