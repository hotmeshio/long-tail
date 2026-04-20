import { Router } from 'express';

import * as yamlDb from '../../services/yaml-workflow/db';
import { cronRegistry } from '../../services/cron';

import { isNotFoundError } from './helpers';

const router = Router();

/**
 * PUT /api/yaml-workflows/:id/cron
 * Set or update cron schedule + envelope + execute_as.
 */
router.put('/:id/cron', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }

    const { cron_schedule, cron_envelope, execute_as } = req.body;
    if (!cron_schedule || typeof cron_schedule !== 'string') {
      res.status(400).json({ error: 'cron_schedule is required' });
      return;
    }

    const updated = await yamlDb.updateCronSchedule(
      wf.id,
      cron_schedule.trim(),
      cron_envelope ?? null,
      execute_as ?? null,
    );

    if (updated) {
      await cronRegistry.restartYamlCron(updated);
    }

    res.json(updated);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/yaml-workflows/:id/cron
 * Clear cron schedule.
 */
router.delete('/:id/cron', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }

    await cronRegistry.stopYamlCron(wf.id);
    const updated = await yamlDb.clearCronSchedule(wf.id);

    res.json(updated);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/yaml-workflows/cron/status
 * List all YAML workflows with active cron schedules.
 */
router.get('/cron/status', async (_req, res) => {
  try {
    const workflows = await yamlDb.getCronScheduledWorkflows();
    const activeTypes = cronRegistry.activeWorkflowTypes;

    const schedules = workflows.map((wf) => ({
      id: wf.id,
      name: wf.name,
      graph_topic: wf.graph_topic,
      app_id: wf.app_id,
      cron_schedule: wf.cron_schedule,
      execute_as: wf.execute_as,
      active: activeTypes.includes(`yaml:${wf.id}`),
    }));

    res.json({ schedules });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
