import { Router } from 'express';

import { maintenanceRegistry } from '../services/maintenance';
import { requireAdmin } from '../modules/auth';
import type { LTMaintenanceConfig } from '../types/maintenance';

const router = Router();

/**
 * GET /api/config/maintenance
 * Return the current maintenance configuration.
 */
router.get('/', (_req, res) => {
  const config = maintenanceRegistry.config;
  res.json({ config, active: maintenanceRegistry.hasConfig });
});

/**
 * PUT /api/config/maintenance
 * Replace the maintenance configuration and restart the cron.
 * Admin-only.
 *
 * Body: { schedule: string, rules: LTMaintenanceRule[] }
 */
router.put('/', requireAdmin, async (req, res) => {
  try {
    const { schedule, rules } = req.body as LTMaintenanceConfig;

    if (!schedule || !Array.isArray(rules)) {
      res.status(400).json({ error: 'schedule (string) and rules (array) are required' });
      return;
    }

    await maintenanceRegistry.disconnect();
    maintenanceRegistry.register({ schedule, rules });
    await maintenanceRegistry.connect();

    res.json({ config: maintenanceRegistry.config, restarted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
