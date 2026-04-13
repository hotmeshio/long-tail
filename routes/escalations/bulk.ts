import { Router, Request, Response } from 'express';

import * as escalationService from '../../services/escalation';
import * as taskService from '../../services/task';
import * as userService from '../../services/user';
import { createClient } from '../../workers';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { publishEscalationEvent } from '../../services/events/publish';

// ── Shared helpers ──────────────────────────────────────────────────────────

function validateIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0;
}

async function requireBulkPermission(
  userId: string,
  ids: string[],
  res: Response,
): Promise<boolean> {
  const isSuperAdminUser = await userService.isSuperAdmin(userId);
  if (isSuperAdminUser) return true;

  const roles = await escalationService.getEscalationRoles(ids);
  for (const role of roles) {
    const canManage = await userService.isGroupAdmin(userId, role);
    if (!canManage) {
      res.status(403).json({ error: `Insufficient permissions for role "${role}"` });
      return false;
    }
  }
  return true;
}

function publishBulkClaimEvents(ids: string[], assignedTo: string): void {
  for (const id of ids) {
    publishEscalationEvent({
      type: 'escalation.claimed',
      source: 'api',
      workflowId: '',
      workflowName: '',
      taskQueue: '',
      escalationId: id,
      status: 'claimed',
      data: { assigned_to: assignedTo, bulk: true },
    });
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerBulkRoutes(router: Router): void {
  router.post('/release-expired', async (_req, res) => {
    try {
      const released = await escalationService.releaseExpiredClaims();
      res.json({ released });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/priority', async (req, res) => {
    try {
      const { ids, priority } = req.body || {};
      if (!validateIds(ids)) return res.status(400).json({ error: 'ids must be a non-empty array' });
      if (![1, 2, 3, 4].includes(priority)) return res.status(400).json({ error: 'priority must be 1, 2, 3, or 4' });

      if (!await requireBulkPermission(req.auth!.userId, ids, res)) return;

      const updated = await escalationService.updateEscalationsPriority(ids, priority);
      res.json({ updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/bulk-claim', async (req, res) => {
    try {
      const userId = req.auth!.userId;
      const { ids, durationMinutes } = req.body || {};
      if (!validateIds(ids)) return res.status(400).json({ error: 'ids must be a non-empty array' });

      if (!await requireBulkPermission(userId, ids, res)) return;

      const result = await escalationService.bulkClaimEscalations(ids, userId, durationMinutes ?? 30);
      res.json(result);
      if (result.claimed > 0) publishBulkClaimEvents(ids, userId);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/bulk-assign', async (req, res) => {
    try {
      const userId = req.auth!.userId;
      const { ids, targetUserId, durationMinutes } = req.body || {};
      if (!validateIds(ids)) return res.status(400).json({ error: 'ids must be a non-empty array' });
      if (!targetUserId || typeof targetUserId !== 'string') return res.status(400).json({ error: 'targetUserId is required' });

      if (!await requireBulkPermission(userId, ids, res)) return;

      // Non-superadmin: target user must hold each escalation's role
      const isSuperAdminUser = await userService.isSuperAdmin(userId);
      if (!isSuperAdminUser) {
        const roles = await escalationService.getEscalationRoles(ids);
        for (const role of roles) {
          const targetHasRole = await userService.hasRole(targetUserId, role);
          if (!targetHasRole) {
            return res.status(400).json({ error: `Target user does not hold the "${role}" role` });
          }
        }
      }

      const result = await escalationService.bulkAssignEscalations(ids, targetUserId, durationMinutes ?? 30);
      res.json(result);
      if (result.assigned > 0) publishBulkClaimEvents(ids, targetUserId);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/bulk-escalate', async (req, res) => {
    try {
      const { ids, targetRole } = req.body || {};
      if (!validateIds(ids)) return res.status(400).json({ error: 'ids must be a non-empty array' });
      if (!targetRole || typeof targetRole !== 'string') return res.status(400).json({ error: 'targetRole is required' });

      if (!await requireBulkPermission(req.auth!.userId, ids, res)) return;

      const updated = await escalationService.bulkEscalateToRole(ids, targetRole);
      res.json({ updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/bulk-triage', async (req: Request, res: Response) => {
    try {
      const { ids, hint } = req.body || {};
      if (!validateIds(ids)) return res.status(400).json({ error: 'ids must be a non-empty array' });

      if (!await requireBulkPermission(req.auth!.userId, ids, res)) return;

      const resolved = await escalationService.bulkResolveForTriage(ids, hint);
      const client = createClient();
      const workflowIds: string[] = [];

      for (const escalation of resolved) {
        const triageWorkflowId = await startTriageWorkflow(escalation, hint, req.auth?.userId, client);
        workflowIds.push(triageWorkflowId);
      }

      res.json({ triaged: resolved.length, workflows: workflowIds });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ── Triage workflow launcher ────────────────────────────────────────────────

async function startTriageWorkflow(
  escalation: any,
  hint: string | undefined,
  userId: string | undefined,
  client: ReturnType<typeof createClient>,
): Promise<string> {
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
    lt: { ...(envelope.lt || {}), userId },
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

  return triageWorkflowId;
}
