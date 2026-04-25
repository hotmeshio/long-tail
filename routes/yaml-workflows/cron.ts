import { Router } from 'express';

import * as api from '../../api/yaml-workflows';

const router = Router();

/**
 * PUT /api/yaml-workflows/:id/cron
 * Set or update cron schedule + envelope + execute_as.
 */
router.put('/:id/cron', async (req, res) => {
  const result = await api.setCronSchedule({
    id: req.params.id,
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
router.delete('/:id/cron', async (req, res) => {
  const result = await api.clearCronSchedule({ id: req.params.id });
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
