import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';
import { signToken } from '../../modules/auth';

// A run's result and execution history are readable by a builder and by the
// person who started the run or it runs as; its full state is builder only.

const ctx = setupRouteTest(4652);

const STARTER = randomUUID();
const RUNS_AS = randomUUID();
const STRANGER = randomUUID();
const WORKFLOW_ID = `read-access-${randomUUID()}`;

const memberToken = (userId: string) => signToken({ userId, role: 'member' });
const status = async (path: string, token: string) =>
  (await fetch(`${ctx.BASE}${path}`, { headers: authHeaders(token) })).status;

beforeAll(async () => {
  await getPool().query(
    `INSERT INTO lt_tasks (workflow_id, workflow_type, lt_type, signal_id, parent_workflow_id, envelope, initiated_by, executing_as)
     VALUES ($1, 'readAccessTest', 'test', $1, $1, '{}', $2, $3)`,
    [WORKFLOW_ID, STARTER, RUNS_AS],
  );
});

afterAll(async () => {
  await getPool().query('DELETE FROM lt_tasks WHERE workflow_id = $1', [WORKFLOW_ID]);
});

describe('workflow run reads', () => {
  const owned = [`/workflows/${WORKFLOW_ID}/result`, `/workflow-states/${WORKFLOW_ID}/execution`];

  it('the person who started the run reads its result and execution', async () => {
    for (const path of owned) expect({ path, status: await status(path, memberToken(STARTER)) }).not.toMatchObject({ status: 403 });
  });

  it('the person the run executes as reads them too', async () => {
    for (const path of owned) expect({ path, status: await status(path, memberToken(RUNS_AS)) }).not.toMatchObject({ status: 403 });
  });

  it('anyone else without builder access is refused', async () => {
    for (const path of owned) expect({ path, status: await status(path, memberToken(STRANGER)) }).toEqual({ path, status: 403 });
  });

  it('the full state, envelopes and export stay builder only, even for the starter', async () => {
    const builderOnly = [
      `/workflow-states/${WORKFLOW_ID}`,
      `/workflow-states/${WORKFLOW_ID}/envelopes`,
      `/workflows/${WORKFLOW_ID}/export`,
      `/workflows/${WORKFLOW_ID}/status`,
    ];
    for (const path of builderOnly) expect({ path, status: await status(path, memberToken(STARTER)) }).toEqual({ path, status: 403 });
    for (const path of builderOnly) expect({ path, status: await status(path, ctx.builderToken) }).not.toMatchObject({ status: 403 });
  });
});
