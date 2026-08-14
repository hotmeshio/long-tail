import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  applyWorkflowConfig,
  seedWorkflowConfig,
} from '../../../services/config/write';
import { getWorkflowConfig } from '../../../services/config/read';
import type { LTWorkflowConfig } from '../../../types';

// read_safe — the side-effect-free registration flag gating
// invoke_workflow_read_safe. Fail-closed: omitted reads as false, and only an
// explicit true opens the read-scoped invocation surface.

const WF = `readSafeFlow${Date.now()}`;
const ROLE = `${WF}-role`;

function declaration(overrides: Partial<LTWorkflowConfig> = {}): LTWorkflowConfig {
  return {
    workflow_type: WF,
    task_queue: 'read-safe-queue',
    invocable: true,
    default_role: ROLE,
    description: 'lookup flow',
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

describe('config service — read_safe flag', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_config_workflows WHERE workflow_type = $1', [WF]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('an omitted flag registers as NOT read-safe', async () => {
    await applyWorkflowConfig(declaration());
    expect((await getWorkflowConfig(WF))?.read_safe).toBe(false);
  });

  it('flipping only read_safe is a real change on the apply path', async () => {
    expect(await applyWorkflowConfig(declaration({ read_safe: true }))).toBe('applied');
    expect((await getWorkflowConfig(WF))?.read_safe).toBe(true);
    expect(await applyWorkflowConfig(declaration({ read_safe: true }))).toBe('unchanged');
  });

  it('the seed path leaves an existing row alone and warns on drift', async () => {
    // Row currently read_safe: true; the db-owned seed with false must not clobber it.
    const inserted = await seedWorkflowConfig(declaration({ read_safe: false }));
    expect(inserted).toBe(false);
    expect((await getWorkflowConfig(WF))?.read_safe).toBe(true);
  });
});
