import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as escalationService from '../../../services/escalation';
import * as userService from '../../../services/user';
import * as knowledge from '../../../system/activities/knowledge';
import { createHumanQueueServer } from '../../../system/mcp-servers/human-queue';

const { Connection } = Durable;

// get_escalation_lookups over /mcp answers as the caller, with the read check
// the REST route runs: the row's refs are the grant, for whoever may read it.

const ROLE = `hq-lookups-${Durable.guid()}`;
const DOMAIN = `hq-lookups-${Durable.guid()}`;
const ids: string[] = [];
const users: string[] = [];

let readerId: string;
let selfReaderId: string;
let outsiderId: string;

async function call(escalationId: string, userId?: string) {
  const server = await createHumanQueueServer({ name: 'hq-lookups-test' });
  const tool = (server as any)._registeredTools.get_escalation_lookups;
  const extra = userId ? { authInfo: { userId, role: 'member' } } : undefined;
  const result = await tool.handler({ escalation_id: escalationId }, extra);
  return { isError: !!result.isError, body: JSON.parse(result.content[0].text) };
}

async function row(lookups: unknown[]) {
  const created = await escalationService.createEscalation({
    type: 'hq-lookups-test', role: ROLE, description: 'lookups', envelope: JSON.stringify({ lookups }),
  });
  ids.push(created.id);
  return created;
}

async function user(tag: string, roles: Parameters<typeof userService.createUser>[0]['roles']) {
  const created = await userService.createUser({ external_id: `${ROLE}-${tag}`, roles });
  users.push(created.id);
  return created.id;
}

beforeAll(async () => {
  await connectTelemetry();
  await Connection.connect({ class: Postgres, options: postgres_options });
  await migrate();
  await knowledge.storeKnowledge({ domain: DOMAIN, key: 'guide', data: { rev: 1 } });
  await knowledge.storeKnowledge({ domain: DOMAIN, key: 'guide', data: { rev: 2 } });
  readerId = await user('reader', [{ role: ROLE, type: 'member', read_scope: 'all', write_scope: 'all' }]);
  selfReaderId = await user('self', [{ role: ROLE, type: 'member', read_scope: 'self', write_scope: 'self' }]);
  outsiderId = await user('outsider', []);
}, 30_000);

afterAll(async () => {
  const { getPool } = await import('../../../lib/db');
  await getPool().query('DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])', [ids]);
  await getPool().query('DELETE FROM lt_knowledge WHERE domain = $1', [DOMAIN]);
  for (const id of users) await userService.deleteUser(id);
  await Durable.shutdown();
  await disconnectTelemetry();
}, 10_000);

describe('get_escalation_lookups as the /mcp caller', () => {
  it('a reader of the role gets each ref: current, pinned, and missing', async () => {
    const esc = await row([
      { domain: DOMAIN, key: 'guide', as: 'guide' },
      { domain: DOMAIN, key: 'guide', version: 1, as: 'first' },
      { domain: DOMAIN, key: 'absent' },
    ]);
    const { isError, body } = await call(esc.id, readerId);
    expect(isError).toBe(false);
    expect(body.escalation_id).toBe(esc.id);
    expect(body.lookups[0]).toMatchObject({ as: 'guide', version: 2, data: { rev: 2 } });
    expect(body.lookups[1]).toMatchObject({ as: 'first', version: 1, data: { rev: 1 } });
    expect(body.lookups[2]).toMatchObject({ key: 'absent', missing: true });
  });

  it('a caller outside the role is refused with no edition content', async () => {
    const esc = await row([{ domain: DOMAIN, key: 'guide' }]);
    const { isError, body } = await call(esc.id, outsiderId);
    expect(isError).toBe(true);
    expect(body).toEqual({ error: 'Not authorized to view this escalation' });
  });

  it('a self-scope reader reads only a row assigned to them', async () => {
    const esc = await row([{ domain: DOMAIN, key: 'guide' }]);
    expect((await call(esc.id, selfReaderId)).isError).toBe(true);
    await escalationService.claimEscalation(esc.id, selfReaderId);
    const { isError, body } = await call(esc.id, selfReaderId);
    expect(isError).toBe(false);
    expect(body.lookups[0]).toMatchObject({ version: 2 });
  });

  it('a closed row answers with the edition current when it closed', async () => {
    const esc = await row([{ domain: DOMAIN, key: 'later' }]);
    await knowledge.storeKnowledge({ domain: DOMAIN, key: 'later', data: { rev: 1 } });
    await escalationService.cancelEscalation(esc.id);
    await knowledge.storeKnowledge({ domain: DOMAIN, key: 'later', data: { rev: 2 } });
    const { body } = await call(esc.id, readerId);
    expect(body.lookups[0]).toMatchObject({ version: 1, data: { rev: 1 } });
  });

  it('an internal call with no caller reads as lt-system', async () => {
    const esc = await row([{ domain: DOMAIN, key: 'guide' }]);
    const { isError, body } = await call(esc.id);
    expect(isError).toBe(false);
    expect(body.lookups[0]).toMatchObject({ version: 2 });
  });

  it('an unknown row answers not found', async () => {
    const { isError, body } = await call('00000000-0000-4000-8000-000000000000', readerId);
    expect(isError).toBe(true);
    expect(body).toEqual({ error: 'Escalation not found' });
  });
});
