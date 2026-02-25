import { getPool } from './db';
import type {
  LTWorkflowConfig,
  LTLifecycleHook,
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

  const [rolesResult, lifecycleResult] = await Promise.all([
    pool.query(
      'SELECT role FROM lt_config_roles WHERE workflow_type = $1 ORDER BY role',
      [workflowType],
    ),
    pool.query(
      'SELECT hook, target_workflow_type, target_task_queue, ordinal FROM lt_config_lifecycle WHERE workflow_type = $1 ORDER BY hook, ordinal',
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
    consumes: wf.consumes || [],
  };
}

export async function listWorkflowConfigs(): Promise<LTWorkflowConfig[]> {
  const pool = getPool();

  const [wfResult, rolesResult, lifecycleResult] =
    await Promise.all([
      pool.query('SELECT * FROM lt_config_workflows ORDER BY workflow_type'),
      pool.query('SELECT * FROM lt_config_roles ORDER BY workflow_type, role'),
      pool.query(
        'SELECT * FROM lt_config_lifecycle ORDER BY workflow_type, hook, ordinal',
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
    consumes: wf.consumes || [],
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
         (workflow_type, is_lt, is_container, task_queue, default_role, default_modality, description, consumes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (workflow_type) DO UPDATE SET
         is_lt = EXCLUDED.is_lt,
         is_container = EXCLUDED.is_container,
         task_queue = EXCLUDED.task_queue,
         default_role = EXCLUDED.default_role,
         default_modality = EXCLUDED.default_modality,
         description = EXCLUDED.description,
         consumes = EXCLUDED.consumes`,
      [
        config.workflow_type,
        config.is_lt,
        config.is_container,
        config.task_queue,
        config.default_role,
        config.default_modality,
        config.description,
        config.consumes,
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
      consumes: c.consumes,
    });
  }

  return map;
}

// ─── Provider data ───────────────────────────────────────────────────────────

export async function getProviderData(
  consumes: string[],
  originId: string,
): Promise<LTProviderData> {
  if (!consumes.length || !originId) return {};

  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT workflow_type, data, completed_at
     FROM lt_tasks
     WHERE origin_id = $1
       AND workflow_type = ANY($2)
       AND status = 'completed'
     ORDER BY completed_at DESC`,
    [originId, consumes],
  );

  const result: LTProviderData = {};
  for (const row of rows) {
    // Keep first (most recent) per workflow type
    if (result[row.workflow_type]) continue;
    let parsed: Record<string, any> = {};
    try {
      parsed = row.data ? JSON.parse(row.data) : {};
    } catch {
      parsed = {};
    }
    result[row.workflow_type] = {
      data: parsed,
      completedAt: row.completed_at?.toISOString() || '',
      workflowType: row.workflow_type,
    };
  }

  return result;
}
