import { Router } from '../../lib/http';

import * as api from '../../api/escalations';

export function registerWaitRoutes(router: Router): void {
  /**
   * POST /api/escalations/waits
   * Open the escalation a workflow on the configured durable provider waits on.
   * Idempotent on (workflowId, runScope, waitKey). RBAC as POST /api/escalations.
   *
   * Body: { workflowId, runScope?, workflowType?, waitKey, role, type, subtype?,
   *         description?, priority?, metadata?, data?, expiresAt?,
   *         batch?, filled?, wakeOnFill?, wakeOnFlag?, partialOnTimeout?, accumulate?,
   *         envelope?, lookups?, files?, schemaVersion?, assignee?, durationMinutes?,
   *         originId?, parentId?, signalKey? }
   */
  router.post('/waits', async (req, res) => {
    const body = req.body ?? {};
    const result = await api.openDurableWait(
      {
        workflowId: body.workflowId,
        runScope: body.runScope,
        workflowType: body.workflowType,
        waitKey: body.waitKey,
        role: body.role,
        type: body.type,
        subtype: body.subtype,
        description: body.description,
        priority: body.priority,
        metadata: body.metadata,
        data: body.data,
        expiresAt: body.expiresAt,
        batch: body.batch,
        filled: body.filled,
        wakeOnFill: body.wakeOnFill,
        wakeOnFlag: body.wakeOnFlag,
        partialOnTimeout: body.partialOnTimeout,
        accumulate: body.accumulate,
        envelope: body.envelope,
        lookups: body.lookups,
        files: body.files,
        schemaVersion: body.schemaVersion,
        assignee: body.assignee,
        durationMinutes: body.durationMinutes,
        originId: body.originId,
        parentId: body.parentId,
        signalKey: body.signalKey,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
