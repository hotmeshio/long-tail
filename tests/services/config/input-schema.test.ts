import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  applyWorkflowConfig,
  seedWorkflowConfig,
} from '../../../services/config/write';
import { getWorkflowConfig, listWorkflowConfigs } from '../../../services/config/read';
import type { LTWorkflowConfig } from '../../../types';

// input_schema — the opt-in x-lt-* form the invoke surface renders and the
// invoke API validates against. Omitted reads as null (legacy template form).

const WF = `inputSchemaFlow${Date.now()}`;
const ROLE = `${WF}-role`;
const SCHEMA = {
  'x-lt-layout': 'two-column',
  required: ['serialNumber'],
  properties: { serialNumber: { type: 'string', title: 'Serial' } },
};

function declaration(overrides: Partial<LTWorkflowConfig> = {}): LTWorkflowConfig {
  return {
    workflow_type: WF,
    task_queue: 'input-schema-queue',
    invocable: true,
    default_role: ROLE,
    description: 'tools flow',
    roles: [],
    invocation_roles: [],
    consumes: [],
    tool_tags: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
    ...overrides,
  } as LTWorkflowConfig;
}

describe('config service — input_schema', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_config_workflows WHERE workflow_type = $1', [WF]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('an omitted schema stores as null', async () => {
    await applyWorkflowConfig(declaration());
    expect((await getWorkflowConfig(WF))?.input_schema).toBeNull();
  });

  it('declaring the schema is a real change and round-trips as parsed JSON', async () => {
    expect(await applyWorkflowConfig(declaration({ input_schema: SCHEMA }))).toBe('applied');
    expect((await getWorkflowConfig(WF))?.input_schema).toEqual(SCHEMA);
    expect((await listWorkflowConfigs()).find((c) => c.workflow_type === WF)?.input_schema).toEqual(SCHEMA);
    expect(await applyWorkflowConfig(declaration({ input_schema: SCHEMA }))).toBe('unchanged');
  });

  it('changing one property re-applies', async () => {
    const changed = { ...SCHEMA, required: [] };
    expect(await applyWorkflowConfig(declaration({ input_schema: changed }))).toBe('applied');
    expect((await getWorkflowConfig(WF))?.input_schema).toEqual(changed);
  });

  it('the db-owned seed leaves an existing row alone', async () => {
    const inserted = await seedWorkflowConfig(declaration({ input_schema: null }));
    expect(inserted).toBe(false);
    expect((await getWorkflowConfig(WF))?.input_schema).not.toBeNull();
  });
});
