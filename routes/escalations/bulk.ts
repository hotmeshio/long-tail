import { Router } from 'express';

import * as api from '../../api/escalations';

export function registerBulkRoutes(router: Router): void {
  router.post('/release-expired', async (_req, res) => {
    const result = await api.releaseExpiredClaims();
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  router.patch('/priority', async (req, res) => {
    const result = await api.updatePriority(
      { ids: req.body?.ids, priority: req.body?.priority },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  router.post('/bulk-claim', async (req, res) => {
    const result = await api.bulkClaim(
      { ids: req.body?.ids, durationMinutes: req.body?.durationMinutes },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  router.post('/bulk-assign', async (req, res) => {
    const result = await api.bulkAssign(
      {
        ids: req.body?.ids,
        targetUserId: req.body?.targetUserId,
        durationMinutes: req.body?.durationMinutes,
      },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  router.patch('/bulk-escalate', async (req, res) => {
    const result = await api.bulkEscalate(
      { ids: req.body?.ids, targetRole: req.body?.targetRole },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });

  router.post('/bulk-triage', async (req, res) => {
    const result = await api.bulkTriage(
      { ids: req.body?.ids, hint: req.body?.hint },
      req.auth!,
    );
    res.status(result.status).json(result.data ?? { error: result.error });
  });
}
