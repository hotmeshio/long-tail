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
const RUN = Date.now();
const BIN = `ext-bin-${RUN}`;
const UP = `ext-up-${RUN}`;
const VIEWER = '55555555-5555-4555-8555-555555555555';
const GLOBAL = { global: true };

// Real rows: a bin holding items with commit dates and weights, a batch row,
// an empty bin, and upstream rows sharing a destination.
describe('related set min/max SQL against real rows', () => {
  const ids: string[] = [];
  let bin: string;
  let empty: string;
  let batch: string;

  const create = async (params: Record<string, unknown>) => {
    const row = await (await escalations()).create(params as any);
    ids.push(row.id);
    return row.id;
  };
  const add = async (itemKey: string, payload: Record<string, unknown>) => {
    const added = await escalationService.accumulateItem(bin, { itemKey, payload } as any);
    expect(added.outcome).toBe('accepted');
  };

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    bin = await create({ role: BIN, metadata: { destination: 'north' }, accumulate: { max: 10 } });
    empty = await create({ role: BIN, metadata: { destination: 'south' }, accumulate: { max: 10 } });
    await add('a', { commitBy: '2026-10-22', weight: 10 });
    await add('b', { commitBy: '2026-10-09', weight: 9 });
    await add('c', { commitBy: '2026-11-01', weight: 100, note: { nested: true } });
    await add('d', { weight: 'heavy' });
    batch = await create({ role: BIN, metadata: {}, batch: ['cut', 'weld'] });
    await escalationService.resolveBatchItem(batch, 'cut', { weight: 4 } as any);
    await create({ role: UP, metadata: { destination: 'north', due: 30 } });
    await create({ role: UP, metadata: { destination: 'north', due: 4 } });
    await create({ role: UP, metadata: { destination: 'north' } });
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [ids]);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('picks the earliest and latest item value as text', async () => {
    const min = await escalationService.extremeRelatedItems({ hostIds: [bin, empty], scope: GLOBAL, fold: 'min', path: 'payload.commitBy' });
    expect(min[bin]).toEqual({ count: 3, value: '2026-10-09' });
    expect(min[empty]).toEqual({ count: 0 });
    const max = await escalationService.extremeRelatedItems({ hostIds: [bin], scope: GLOBAL, fold: 'max', path: 'payload.commitBy' });
    expect(max[bin]).toEqual({ count: 3, value: '2026-11-01' });
  });

  it('compares numbers as numbers only when every value is one', async () => {
    const batchMax = await escalationService.extremeRelatedItems({ hostIds: [batch], scope: GLOBAL, fold: 'max', path: 'payload.weight' });
    expect(batchMax[batch]).toEqual({ count: 1, value: 4 });
    const mixed = await escalationService.extremeRelatedItems({ hostIds: [bin], scope: GLOBAL, fold: 'max', path: 'payload.weight' });
    expect(mixed[bin]).toEqual({ count: 4, value: 'heavy' });
    const objects = await escalationService.extremeRelatedItems({ hostIds: [bin], scope: GLOBAL, fold: 'min', path: 'payload.note' });
    expect(objects[bin]).toEqual({ count: 0 });
  });

  it('reads items only from hosts inside the scope', async () => {
    const scope = { visibleRoles: [UP], selfRoles: [], meUserId: VIEWER };
    const out = await escalationService.extremeRelatedItems({ hostIds: [bin], scope, fold: 'min', path: 'payload.commitBy' });
    expect(out[bin]).toEqual({ count: 0 });
  });

  it('picks the least related row value by number, under the scope', async () => {
    const hosts = [{ hostId: bin, match: { destination: 'north' } }, { hostId: empty, match: { destination: 'south' } }];
    const min = await escalationService.extremeRelatedQuery({
      hosts, roles: [UP], status: 'pending', scope: GLOBAL, fold: 'min', path: 'metadata.due',
    });
    expect(min[bin]).toEqual({ count: 2, value: 4 });
    expect(min[empty]).toEqual({ count: 0 });
    const outside = { visibleRoles: [BIN], selfRoles: [], meUserId: VIEWER };
    const hidden = await escalationService.extremeRelatedQuery({
      hosts, roles: [UP], status: 'pending', scope: outside, fold: 'max', path: 'metadata.due',
    });
    expect(hidden[bin]).toEqual({ count: 0 });
  });
});
