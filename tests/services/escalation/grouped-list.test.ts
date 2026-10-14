import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { escalations } from '../../../services/escalation/client';
import * as escalationService from '../../../services/escalation';

const { Connection } = Durable;
const ROLE = `grp-bin-${Date.now()}`;

// Rows paged by a shared facet: a page holds whole groups, a row without the
// facet is a group of one, and the total counts groups.
describe('grouped list paging against real rows', () => {
  const ids: string[] = [];
  const create = async (metadata: Record<string, unknown>, priority: number) => {
    const row = await (await escalations()).create({ role: ROLE, metadata, priority } as any);
    ids.push(row.id);
    return row.id;
  };
  let a1: string;
  let a2: string;
  let b1: string;
  let loose: string;
  const search = (limit: number, offset: number) => escalationService.searchEscalationsGrouped({
    global: true, facet: { role: ROLE, status: 'pending' }, limit, offset, groupKey: 'binKey',
  });

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    a1 = await create({ binKey: 'A', serviceLevel: 'standard' }, 1);
    b1 = await create({ binKey: 'B' }, 2);
    a2 = await create({ binKey: 'A', serviceLevel: 'express' }, 3);
    loose = await create({}, 4);
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [ids]);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('pages whole groups in group order and counts groups', async () => {
    const first = await search(1, 0);
    expect(first.total).toBe(3);
    expect(first.groups).toEqual([{ key: 'A', ids: [a1, a2] }]);
    expect(first.escalations.map((e) => e.id)).toEqual([a1, a2]);
  });

  it('continues with the next group, then a row without the facet', async () => {
    const rest = await search(5, 1);
    expect(rest.groups).toEqual([{ key: 'B', ids: [b1] }, { key: null, ids: [loose] }]);
  });

  it('honors the scope', async () => {
    const scoped = await escalationService.searchEscalationsGrouped({
      visibleRoles: ['elsewhere'], selfRoles: [], meUserId: 'x', facet: { role: ROLE }, limit: 5, offset: 0, groupKey: 'binKey',
    });
    expect(scoped).toEqual({ escalations: [], total: 0, groups: [] });
  });

  it('refuses a key that is not a metadata key', async () => {
    await expect(escalationService.searchEscalationsGrouped({
      global: true, facet: { role: ROLE }, limit: 5, offset: 0, groupKey: "x'; drop",
    })).rejects.toThrow(/groupBy must be a metadata key/);
  });
});
