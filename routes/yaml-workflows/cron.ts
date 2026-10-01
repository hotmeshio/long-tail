import { Router } from '../../lib/http';

import * as api from '../../api/yaml-workflows';
import { requireBuilder } from '../../modules/auth';
import { assertMayActAs, InvocationError } from '../../services/workflow-invocation';

const router = Router();

/**
 * PUT /api/yaml-workflows/:id/cron
 * Set or update cron schedule + envelope + execute_as.
 */
router.put('/:id/cron', requireBuilder, async (req, res) => {
  if (req.body.execute_as) {
    try {
      await assertMayActAs(req.auth!.userId, req.body.execute_as);
    } catch (err: any) {
      if (!(err instanceof InvocationError)) throw err;
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
  }
  const result = await api.setCronSchedule({
    id: String(req.params.id),
    cron_schedule: req.body.cron_schedule,
    cron_envelope: req.body.cron_envelope,
    execute_as: req.body.execute_as,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/yaml-workflows/:id/cron
 * Clear cron schedule.
 */
router.delete('/:id/cron', requireBuilder, async (req, res) => {
  const result = await api.clearCronSchedule({ id: String(req.params.id) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/yaml-workflows/cron/status
 * List all YAML workflows with active cron schedules.
 */
router.get('/cron/status', async (_req, res) => {
  const result = await api.getCronStatus();
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
