import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  applyWorkflowConfig,
  seedWorkflowConfig,
} from '../../../services/config/write';
import { getWorkflowConfig } from '../../../services/config/read';
import type { LTWorkflowConfig } from '../../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Startup workflow-config apply — code is source of truth. The declaration is
// diffed against the stored row and written through the full-replace
// transaction only when something differs. `certified` is explicit-only on
// this path: an omitted flag registers as NOT certified (the legacy seed keeps
// its roles/consumes derivation).
// ─────────────────────────────────────────────────────────────────────────────

const WF = `applyFlow${Date.now()}`;
const WF_LEGACY = `${WF}Legacy`;
const ROLE_A = `${WF}-role-a`;
const ROLE_B = `${WF}-role-b`;

function declaration(overrides: Partial<LTWorkflowConfig> = {}): LTWorkflowConfig {
  return {
    workflow_type: WF,
    task_queue: 'apply-queue',
    invocable: true,
    default_role: ROLE_A,
    description: 'startup apply flow',
    roles: [ROLE_A],
    invocation_roles: [ROLE_A],
    consumes: [],
    tool_tags: [],
    envelope_schema: { data: { note: 'hi' } },
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
    ...overrides,
  } as LTWorkflowConfig;
}

describe('config service — startup apply', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_config_workflows WHERE workflow_type = ANY($1)', [[WF, WF_LEGACY]]);
    await pool.query('DELETE FROM lt_roles WHERE role = ANY($1)', [[ROLE_A, ROLE_B]]);
  });

  it('registers a new workflow as NOT certified when the flag is omitted', async () => {
    // roles are declared, which would derive certified=true on the legacy path
    expect(await applyWorkflowConfig(declaration())).toBe('applied');
    const stored = await getWorkflowConfig(WF);
    expect(stored?.certified).toBe(false);
    expect(stored?.roles).toEqual([ROLE_A]);
  });

  it('an identical second apply is a no-op', async () => {
    expect(await applyWorkflowConfig(declaration())).toBe('unchanged');
  });

  it('a changed declaration replaces the row and the role lists', async () => {
    const outcome = await applyWorkflowConfig(
      declaration({ description: 'updated flow', roles: [ROLE_A, ROLE_B] }),
    );
    expect(outcome).toBe('applied');

    const stored = await getWorkflowConfig(WF);
    expect(stored?.description).toBe('updated flow');
    expect([...(stored?.roles ?? [])].sort()).toEqual([ROLE_A, ROLE_B].sort());
  });

  it('the legacy seed path still derives certified from roles presence', async () => {
    await seedWorkflowConfig(declaration({ workflow_type: WF_LEGACY, certified: undefined }));
    expect((await getWorkflowConfig(WF_LEGACY))?.certified).toBe(true);
  });
});
