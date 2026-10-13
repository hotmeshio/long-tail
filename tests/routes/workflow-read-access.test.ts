import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

import { setupRouteTest, authHeaders } from './setup';
import { signToken } from '../../modules/auth';
import { invokeWorkflow } from '../../services/workflow-invocation';

// A run's result and execution history are readable by a builder and by the
// person who started it, read from the run's own start envelope; its full
// state is builder only. The run is a registered durable worker with no
// config row, so nothing about it lives outside the run itself.

export async function readAccessRun(): Promise<{ type: 'return'; data: { ok: boolean } }> {
  return { type: 'return', data: { ok: true } };
}

const ctx = setupRouteTest(4652, {
  workers: [{ taskQueue: 'read-access-test', workflow: readAccessRun }],
} as any);

const STARTER = randomUUID();
const STRANGER = randomUUID();
let workflowId: string;

const memberToken = (userId: string) => signToken({ userId, role: 'member' });
const status = async (path: string, token: string) =>
  (await fetch(`${ctx.BASE}${path}`, { headers: authHeaders(token) })).status;

beforeAll(async () => {
  ({ workflowId } = await invokeWorkflow({
    workflowType: 'readAccessRun',
    data: {},
    auth: { userId: STARTER },
  }));
  // Let the run finish so its result is readable.
  for (let i = 0; i < 40; i++) {
    if ((await status(`/workflows/${workflowId}/result`, ctx.builderToken)) === 200) break;
    await new Promise((r) => setTimeout(r, 250));
  }
}, 30_000);

describe('workflow run reads', () => {
  const owned = () => [`/workflows/${workflowId}/result`, `/workflow-states/${workflowId}/execution`];

  it('the person who started the run reads its result and execution', async () => {
    for (const path of owned()) expect({ path, status: await status(path, memberToken(STARTER)) }).toEqual({ path, status: 200 });
  });

  it('anyone else without builder access is refused', async () => {
    for (const path of owned()) expect({ path, status: await status(path, memberToken(STRANGER)) }).toEqual({ path, status: 403 });
  });

  it('a run that does not exist is refused to a non-builder', async () => {
    expect(await status(`/workflows/no-such-run-${randomUUID()}/result`, memberToken(STARTER))).toBe(403);
  });

  it('the full state, envelopes and export stay builder only, even for the starter', async () => {
    const builderOnly = [
      `/workflow-states/${workflowId}`,
      `/workflow-states/${workflowId}/envelopes`,
      `/workflows/${workflowId}/export`,
      `/workflows/${workflowId}/status`,
    ];
    for (const path of builderOnly) expect({ path, status: await status(path, memberToken(STARTER)) }).toEqual({ path, status: 403 });
    for (const path of builderOnly) expect({ path, status: await status(path, ctx.builderToken) }).not.toMatchObject({ status: 403 });
  });
});
