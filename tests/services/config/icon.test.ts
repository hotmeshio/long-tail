import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { applyWorkflowConfig, seedWorkflowConfig } from '../../../services/config/write';
import { getWorkflowConfig } from '../../../services/config/read';
import { WORKFLOW_ICONS } from '../../../types/workflow-icons';
import type { LTWorkflowConfig } from '../../../types';

// icon — the curated glyph a workflow declares for the Invoke page. Omitted
// reads as null (the tier glyph).

const WF = `iconFlow${Date.now()}`;
const ROLE = `${WF}-role`;

function declaration(overrides: Partial<LTWorkflowConfig> = {}): LTWorkflowConfig {
  return {
    workflow_type: WF, task_queue: 'icon-queue', invocable: true, default_role: ROLE, description: 'icon flow',
    roles: [], invocation_roles: [], consumes: [], tool_tags: [], envelope_schema: null, resolver_schema: null,
    cron_schedule: null, execute_as: null, ...overrides,
  } as LTWorkflowConfig;
}

describe('config service — icon', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_config_workflows WHERE workflow_type = $1', [WF]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('an omitted icon stores as null', async () => {
    await applyWorkflowConfig(declaration());
    expect((await getWorkflowConfig(WF))?.icon).toBeNull();
  });

  it('declaring or changing the icon is a real change', async () => {
    expect(await applyWorkflowConfig(declaration({ icon: WORKFLOW_ICONS.WRENCH }))).toBe('applied');
    expect((await getWorkflowConfig(WF))?.icon).toBe('Wrench');
    expect(await applyWorkflowConfig(declaration({ icon: WORKFLOW_ICONS.WRENCH }))).toBe('unchanged');
    expect(await applyWorkflowConfig(declaration({ icon: WORKFLOW_ICONS.PRINTER }))).toBe('applied');
  });

  it('the db-owned seed leaves an existing row alone', async () => {
    expect(await seedWorkflowConfig(declaration({ icon: null }))).toBe(false);
    expect((await getWorkflowConfig(WF))?.icon).toBe('Printer');
  });
});
