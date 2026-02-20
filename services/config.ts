import { getPool } from './db';
import type {
  LTWorkflowConfig,
  LTLifecycleHook,
  LTConsumerConfig,
  LTResolvedConfig,
  LTProviderData,
} from '../types';

// ─── Read operations ─────────────────────────────────────────────────────────

export async function getWorkflowConfig(
  workflowType: string,
): Promise<LTWorkflowConfig | null> {
  const pool = getPool();

  const { rows: wfRows } = await pool.query(
    'SELECT * FROM lt_config_workflows WHERE workflow_type = $1',
    [workflowType],
  );
  if (wfRows.length === 0) return null;

  const wf = wfRows[0];

  const [rolesResult, lifecycleResult, consumersResult] = await Promise.all([
    pool.query(
      'SELECT role FROM lt_config_roles WHERE workflow_type = $1 ORDER BY role',
      [workflowType],
    ),
    pool.query(
      'SELECT hook, target_workflow_type, target_task_queue, ordinal FROM lt_config_lifecycle WHERE workflow_type = $1 ORDER BY hook, ordinal',
      [workflowType],
    ),
    pool.query(
      'SELECT provider_name, provider_workflow_type, ordinal FROM lt_config_consumers WHERE workflow_type = $1 ORDER BY ordinal',
      [workflowType],
    ),
  ]);

  const onBefore: LTLifecycleHook[] = [];
  const onAfter: LTLifecycleHook[] = [];
  for (const row of lifecycleResult.rows) {
    const hook: LTLifecycleHook = {
      target_workflow_type: row.target_workflow_type,
      target_task_queue: row.target_task_queue,
      ordinal: row.ordinal,
    };
    if (row.hook === 'onBefore') onBefore.push(hook);
    else onAfter.push(hook);
  }

  return {
    workflow_type: wf.workflow_type,
    is_lt: wf.is_lt,
    is_container: wf.is_container,
    task_queue: wf.task_queue,
    default_role: wf.default_role,
    default_modality: wf.default_modality,
    description: wf.description,
    roles: rolesResult.rows.map((r: any) => r.role),
    lifecycle: { onBefore, onAfter },
    consumers: consumersResult.rows.map((r: any) => ({
      provider_name: r.provider_name,
      provider_workflow_type: r.provider_workflow_type,
      ordinal: r.ordinal,
    })),
  };
}

export async function listWorkflowConfigs(): Promise<LTWorkflowConfig[]> {
  const pool = getPool();

  const [wfResult, rolesResult, lifecycleResult, consumersResult] =
    await Promise.all([
      pool.query('SELECT * FROM lt_config_workflows ORDER BY workflow_type'),
      pool.query('SELECT * FROM lt_config_roles ORDER BY workflow_type, role'),
      pool.query(
        'SELECT * FROM lt_config_lifecycle ORDER BY workflow_type, hook, ordinal',
      ),
      pool.query(
        'SELECT * FROM lt_config_consumers ORDER BY workflow_type, ordinal',
      ),
    ]);

  // Index sub-entities by workflow_type
  const rolesMap = new Map<string, string[]>();
  for (const r of rolesResult.rows) {
    if (!rolesMap.has(r.workflow_type)) rolesMap.set(r.workflow_type, []);
    rolesMap.get(r.workflow_type)!.push(r.role);
  }

  const lifecycleMap = new Map<
    string,
    { onBefore: LTLifecycleHook[]; onAfter: LTLifecycleHook[] }
  >();
  for (const r of lifecycleResult.rows) {
    if (!lifecycleMap.has(r.workflow_type)) {
      lifecycleMap.set(r.workflow_type, { onBefore: [], onAfter: [] });
    }
    const hook: LTLifecycleHook = {
      target_workflow_type: r.target_workflow_type,
      target_task_queue: r.target_task_queue,
      ordinal: r.ordinal,
    };
    if (r.hook === 'onBefore') {
      lifecycleMap.get(r.workflow_type)!.onBefore.push(hook);
    } else {
      lifecycleMap.get(r.workflow_type)!.onAfter.push(hook);
    }
  }

  const consumersMap = new Map<string, LTConsumerConfig[]>();
  for (const r of consumersResult.rows) {
    if (!consumersMap.has(r.workflow_type))
      consumersMap.set(r.workflow_type, []);
    consumersMap.get(r.workflow_type)!.push({
      provider_name: r.provider_name,
      provider_workflow_type: r.provider_workflow_type,
      ordinal: r.ordinal,
    });
  }

  return wfResult.rows.map((wf: any) => ({
    workflow_type: wf.workflow_type,
    is_lt: wf.is_lt,
    is_container: wf.is_container,
    task_queue: wf.task_queue,
    default_role: wf.default_role,
    default_modality: wf.default_modality,
    description: wf.description,
    roles: rolesMap.get(wf.workflow_type) || [],
    lifecycle: lifecycleMap.get(wf.workflow_type) || {
      onBefore: [],
      onAfter: [],
    },
    consumers: consumersMap.get(wf.workflow_type) || [],
  }));
}

// ─── Write operations ────────────────────────────────────────────────────────

export async function upsertWorkflowConfig(
  config: LTWorkflowConfig,
): Promise<LTWorkflowConfig> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Upsert the workflow row
    await client.query(
      `INSERT INTO lt_config_workflows
         (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workflow_type) DO UPDATE SET
         is_lt = EXCLUDED.is_lt,
         is_container = EXCLUDED.is_container,
         task_queue = EXCLUDED.task_queue,
         default_role = EXCLUDED.default_role,
         default_modality = EXCLUDED.default_modality,
         description = EXCLUDED.description`,
      [
        config.workflow_type,
        config.is_lt,
        config.is_container,
        config.task_queue,
        config.default_role,
        config.default_modality,
        config.description,
      ],
    );

    // Replace roles
    await client.query(
      'DELETE FROM lt_config_roles WHERE workflow_type = $1',
      [config.workflow_type],
    );
    for (const role of config.roles) {
      await client.query(
        'INSERT INTO lt_config_roles (workflow_type, role) VALUES ($1, $2)',
        [config.workflow_type, role],
      );
    }

    // Replace lifecycle hooks
    await client.query(
      'DELETE FROM lt_config_lifecycle WHERE workflow_type = $1',
      [config.workflow_type],
    );
    for (const hook of config.lifecycle.onBefore) {
      await client.query(
        `INSERT INTO lt_config_lifecycle (workflow_type, hook, target_workflow_type, target_task_queue, ordinal)
         VALUES ($1, 'onBefore', $2, $3, $4)`,
        [
          config.workflow_type,
          hook.target_workflow_type,
          hook.target_task_queue,
          hook.ordinal,
        ],
      );
    }
    for (const hook of config.lifecycle.onAfter) {
      await client.query(
        `INSERT INTO lt_config_lifecycle (workflow_type, hook, target_workflow_type, target_task_queue, ordinal)
         VALUES ($1, 'onAfter', $2, $3, $4)`,
        [
          config.workflow_type,
          hook.target_workflow_type,
          hook.target_task_queue,
          hook.ordinal,
        ],
      );
    }

    // Replace consumers
    await client.query(
      'DELETE FROM lt_config_consumers WHERE workflow_type = $1',
      [config.workflow_type],
    );
    for (const consumer of config.consumers) {
      await client.query(
        `INSERT INTO lt_config_consumers (workflow_type, provider_name, provider_workflow_type, ordinal)
         VALUES ($1, $2, $3, $4)`,
        [
          config.workflow_type,
          consumer.provider_name,
          consumer.provider_workflow_type,
          consumer.ordinal,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return (await getWorkflowConfig(config.workflow_type))!;
}

export async function deleteWorkflowConfig(
  workflowType: string,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'DELETE FROM lt_config_workflows WHERE workflow_type = $1',
    [workflowType],
  );
  return (rowCount ?? 0) > 0;
}

// ─── Cache loader ────────────────────────────────────────────────────────────

export async function loadAllConfigs(): Promise<Map<string, LTResolvedConfig>> {
  const configs = await listWorkflowConfigs();
  const map = new Map<string, LTResolvedConfig>();

  for (const c of configs) {
    map.set(c.workflow_type, {
      isLT: c.is_lt,
      isContainer: c.is_container,
      taskQueue: c.task_queue,
      role: c.default_role,
      modality: c.default_modality,
      roles: c.roles,
      onBefore: c.lifecycle.onBefore,
      onAfter: c.lifecycle.onAfter,
      consumers: c.consumers,
    });
  }

  return map;
}

// ─── Provider data ───────────────────────────────────────────────────────────

export async function getProviderData(
  consumers: LTConsumerConfig[],
  originId: string,
): Promise<LTProviderData> {
  if (!consumers.length || !originId) return {};

  const pool = getPool();
  const workflowTypes = consumers.map((c) => c.provider_workflow_type);

  const { rows } = await pool.query(
    `SELECT workflow_type, data, completed_at
     FROM lt_tasks
     WHERE origin_id = $1
       AND workflow_type = ANY($2)
       AND status = 'completed'
     ORDER BY completed_at DESC`,
    [originId, workflowTypes],
  );

  // Build lookup: workflow_type → most recent completed task data
  const byType = new Map<string, any>();
  for (const row of rows) {
    if (!byType.has(row.workflow_type)) {
      byType.set(row.workflow_type, row);
    }
  }

  const result: LTProviderData = {};
  for (const consumer of consumers) {
    const row = byType.get(consumer.provider_workflow_type);
    if (row) {
      let parsed: Record<string, any> = {};
      try {
        parsed = row.data ? JSON.parse(row.data) : {};
      } catch {
        parsed = {};
      }
      result[consumer.provider_name] = {
        data: parsed,
        completedAt: row.completed_at?.toISOString() || '',
        workflowType: consumer.provider_workflow_type,
      };
    }
  }

  return result;
}
