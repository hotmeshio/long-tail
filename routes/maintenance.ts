import { Router } from 'express';

import * as api from '../api/maintenance';
import { requireAdmin } from '../modules/auth';

const router = Router();

/**
 * GET /api/config/maintenance
 * Return the current maintenance configuration.
 */
router.get('/', (_req, res) => {
  const result = api.getMaintenanceConfig();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/config/maintenance
 * Replace the maintenance configuration and restart the cron.
 * Admin-only.
 *
 * Body: { schedule: string, rules: LTMaintenanceRule[] }
 */
router.put('/', requireAdmin, async (req, res) => {
  const result = await api.updateMaintenanceConfig({
    schedule: req.body?.schedule,
    rules: req.body?.rules,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
