import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  applyWorkflowConfig,
  seedWorkflowConfig,
} from '../../../services/config/write';
import { getWorkflowConfig, listWorkflowConfigs } from '../../../services/config/read';
import type { LTWorkflowConfig } from '../../../types';

// input_lookups: versioned knowledge refs the invoke form reads under the
// lookup domain. A JSON array round-trips as jsonb; omitted reads as null.

const WF = `inputLookupsFlow${Date.now()}`;
const ROLE = `${WF}-role`;
const REFS = [{ domain: 'fleet', key: 'serial-numbers', version: 1, as: 'serials' }];

function declaration(overrides: Partial<LTWorkflowConfig> = {}): LTWorkflowConfig {
  return {
    workflow_type: WF,
    task_queue: 'input-lookups-queue',
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

describe('config service, input_lookups', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_config_workflows WHERE workflow_type = $1', [WF]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('omitted refs store as null', async () => {
    await applyWorkflowConfig(declaration());
    expect((await getWorkflowConfig(WF))?.input_lookups).toBeNull();
  });

  it('declaring refs is a real change and round-trips as a parsed array', async () => {
    expect(await applyWorkflowConfig(declaration({ input_lookups: REFS }))).toBe('applied');
    expect((await getWorkflowConfig(WF))?.input_lookups).toEqual(REFS);
    expect((await listWorkflowConfigs()).find((c) => c.workflow_type === WF)?.input_lookups).toEqual(REFS);
    expect(await applyWorkflowConfig(declaration({ input_lookups: REFS }))).toBe('unchanged');
  });

  it('repinning a version re-applies', async () => {
    const repinned = [{ ...REFS[0], version: 2 }];
    expect(await applyWorkflowConfig(declaration({ input_lookups: repinned }))).toBe('applied');
    expect((await getWorkflowConfig(WF))?.input_lookups).toEqual(repinned);
  });

  it('the db-owned seed leaves an existing row alone', async () => {
    const inserted = await seedWorkflowConfig(declaration({ input_lookups: null }));
    expect(inserted).toBe(false);
    expect((await getWorkflowConfig(WF))?.input_lookups).not.toBeNull();
  });
});
