import { Router } from '../../lib/http';

import * as api from '../../api/escalations';

export function registerWaitRoutes(router: Router): void {
  /**
   * POST /api/escalations/waits
   * Open the escalation a workflow on the configured durable provider waits on.
   * Idempotent on (workflowId, runScope, waitKey). RBAC as POST /api/escalations.
   *
   * Body: { workflowId, runScope?, workflowType?, waitKey, role, type, subtype?,
   *         description?, priority?, metadata?, data?, expiresAt? }
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
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
