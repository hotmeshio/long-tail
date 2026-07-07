import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as configService from '../../../services/config';
import { upsertWorkflowConfig as apiUpsert } from '../../../api/workflows/config';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Explicit workflow certification — against real Postgres.
//
// Certification is a declared property of the registration (`certified`
// column), not a derivation from roles/consumes. The three tiers are direct
// states: no row = default (durable), certified=false = registered,
// certified=true = certified. Demoting certified → registered flips the flag
// and keeps every other field — escalation roles and consumes survive.
//
// Back-compat: callers that omit `certified` (older SDKs, worker seeds
// without the field) get the pre-flag derivation — certified iff roles or
// consumes are present.
// ─────────────────────────────────────────────────────────────────────────────

const WF = `certified-case-${Date.now()}`;
const ROLE = `certified-role-${Date.now()}`;

const baseConfig = {
  workflow_type: WF,
  invocable: true,
  task_queue: 'certified-case-queue',
  default_role: ROLE,
  description: 'explicit certification case',
  roles: [ROLE],
  invocation_roles: [ROLE],
  consumes: [],
  tool_tags: [],
  envelope_schema: { data: {} },
  resolver_schema: { properties: { approved: { type: 'boolean' } } },
  cron_schedule: null,
  execute_as: null,
};

describe('workflow certification is explicit (integration)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 60_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_config_workflows WHERE workflow_type = $1', [WF]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('persists the declared flag independent of roles/consumes', async () => {
    const saved = await configService.upsertWorkflowConfig({
      ...baseConfig,
      certified: true,
    });
    expect(saved.certified).toBe(true);
    expect(saved.roles).toEqual([ROLE]);
  });

  it('demotes certified → registered while keeping escalation roles intact', async () => {
    const demoted = await configService.upsertWorkflowConfig({
      ...baseConfig,
      certified: false,
    });
    expect(demoted.certified).toBe(false);
    expect(demoted.roles).toEqual([ROLE]);
    expect(demoted.invocation_roles).toEqual([ROLE]);
    expect(demoted.resolver_schema).toEqual(baseConfig.resolver_schema);
  });

  it('a registered workflow with roles is NOT implicitly certified', async () => {
    const read = await configService.getWorkflowConfig(WF);
    expect(read).toBeTruthy();
    expect(read!.roles).toEqual([ROLE]);
    expect(read!.certified).toBe(false);
  });

  it('api upsert without the flag derives it from roles/consumes (back-compat)', async () => {
    const result = await apiUpsert({
      type: WF,
      invocable: true,
      task_queue: baseConfig.task_queue,
      default_role: ROLE,
      roles: [ROLE],
      invocation_roles: [ROLE],
    });
    expect(result.status).toBe(200);
    expect((result.data as any).certified).toBe(true);

    const bare = await apiUpsert({
      type: WF,
      invocable: true,
      task_queue: baseConfig.task_queue,
      default_role: ROLE,
    });
    expect((bare.data as any).certified).toBe(false);
  });

  it('api upsert with the explicit flag wins over the derivation', async () => {
    const result = await apiUpsert({
      type: WF,
      invocable: true,
      task_queue: baseConfig.task_queue,
      default_role: ROLE,
      roles: [ROLE],
      certified: false,
    });
    expect(result.status).toBe(200);
    expect((result.data as any).certified).toBe(false);
    expect((result.data as any).roles).toEqual([ROLE]);
  });
});
