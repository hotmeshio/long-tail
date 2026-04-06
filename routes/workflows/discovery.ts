import { Router } from 'express';

import * as configService from '../../services/config';
import { cronRegistry } from '../../services/cron';
import { getPool } from '../../services/db';
import { getRegisteredWorkers, SYSTEM_WORKFLOWS } from '../../services/workers/registry';

const router = Router();

// ── Active workers ───────────────────────────────────────────────────────────

/**
 * GET /api/workflows/workers
 * Returns in-memory active workers with their registration status.
 * System workflows excluded unless ?include_system=true.
 */
router.get('/workers', async (req, res) => {
  try {
    const includeSystem = req.query.include_system === 'true';
    const activeWorkers = getRegisteredWorkers();
    const configs = await configService.listWorkflowConfigs();
    const registeredTypes = new Set(configs.map((c) => c.workflow_type));

    const workers = [...activeWorkers.entries()]
      .filter(([name]) => includeSystem || !SYSTEM_WORKFLOWS.has(name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { taskQueue }]) => ({
        name,
        task_queue: taskQueue,
        registered: registeredTypes.has(name),
        system: SYSTEM_WORKFLOWS.has(name),
      }));

    res.json({ workers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Discovered workflows ─────────────────────────────────────────────────────

/**
 * GET /api/workflows/discovered
 * Merges active workers, historical entities, and registered configs
 * into a unified list. System workflows excluded unless ?include_system=true.
 */
router.get('/discovered', async (req, res) => {
  try {
    const includeSystem = req.query.include_system === 'true';

    // 1. Active workers from in-memory registry
    const activeWorkers = getRegisteredWorkers();

    // 2. Historical entities from durable.jobs
    const DISTINCT_ENTITIES = `SELECT DISTINCT entity FROM durable.jobs WHERE entity IS NOT NULL AND entity != '' ORDER BY entity`;
    const pool = getPool();
    const { rows: entityRows } = await pool.query<{ entity: string }>(DISTINCT_ENTITIES);
    const historicalEntities = new Set(entityRows.map((r) => r.entity));

    // 3. Registered configs
    const configs = await configService.listWorkflowConfigs();
    const configMap = new Map(configs.map((c) => [c.workflow_type, c]));

    // Build unified set of all workflow types
    const allTypes = new Set<string>();
    for (const [name] of activeWorkers) allTypes.add(name);
    for (const entity of historicalEntities) allTypes.add(entity);
    for (const c of configs) allTypes.add(c.workflow_type);

    const workflows = [...allTypes]
      .filter((t) => includeSystem || !SYSTEM_WORKFLOWS.has(t))
      .sort()
      .map((workflowType) => {
        const config = configMap.get(workflowType);
        const worker = activeWorkers.get(workflowType);
        return {
          workflow_type: workflowType,
          task_queue: config?.task_queue ?? worker?.taskQueue ?? null,
          registered: !!config,
          active: !!worker,
          invocable: config?.invocable ?? !!worker,
          system: SYSTEM_WORKFLOWS.has(workflowType),
          description: config?.description ?? null,
          roles: config?.roles ?? [],
          invocation_roles: config?.invocation_roles ?? [],
          execute_as: config?.execute_as ?? null,
        };
      });

    res.json({ workflows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cron status ─────────────────────────────────────────────────────────────

/**
 * GET /api/workflows/cron/status
 * List all cron-configured workflows and whether each is actively running.
 */
router.get('/cron/status', async (_req, res) => {
  try {
    const configs = await configService.listWorkflowConfigs();
    const cronConfigs = configs.filter((c) => c.cron_schedule);
    const activeTypes = cronRegistry.activeWorkflowTypes;

    const schedules = cronConfigs.map((c) => ({
      workflow_type: c.workflow_type,
      cron_schedule: c.cron_schedule,
      description: c.description,
      task_queue: c.task_queue,
      invocable: c.invocable,
      active: activeTypes.includes(c.workflow_type),
      envelope_schema: c.envelope_schema,
    }));

    res.json({ schedules });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
