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
const BIN = `rel-bin-${RUN}`;
const STAGE = `rel-stage-${RUN}`;
const PREP = `rel-prep-${RUN}`;
const CHECK = `rel-check-${RUN}`;
const VIEWER = '55555555-5555-4555-8555-555555555555';
const GLOBAL = { global: true };

// Real rows: two bins holding reciprocal members with a service level, a
// batch row with payload entries, and upstream rows sharing a destination.
describe('related set SQL against real rows', () => {
  const ids: string[] = [];
  let binA: string;
  let binB: string;
  let batch: string;

  const create = async (params: Record<string, unknown>) => {
    const row = await (await escalations()).create(params as any);
    ids.push(row.id);
    return row.id;
  };
  const member = (orderId: string, serviceLevel: string) =>
    create({ role: STAGE, metadata: { orderId, serviceLevel }, accumulate: { max: 1 } });
  const place = async (bin: string, orderId: string, serviceLevel: string) => {
    const reciprocal = await member(orderId, serviceLevel);
    const added = await escalationService.accumulateItem(bin, {
      itemKey: orderId, payload: { weight: 2, serviceLevel }, reciprocal: { id: reciprocal },
    } as any);
    expect(added.outcome).toBe('accepted');
    return reciprocal;
  };

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    binA = await create({ role: BIN, metadata: { binKey: 'A', destination: 'north' }, accumulate: { max: 10 } });
    binB = await create({ role: BIN, metadata: { binKey: 'B', destination: 7 }, accumulate: { max: 10 } });
    await place(binA, `o1-${RUN}`, 'standard');
    await place(binA, `o2-${RUN}`, 'standard');
    await place(binA, `o3-${RUN}`, 'express');
    batch = await create({ role: BIN, metadata: { binKey: 'C' }, batch: ['cut', 'weld'] });
    await escalationService.resolveBatchItem(batch, 'cut', { tool: 'saw' } as any);
    await create({ role: PREP, metadata: { destination: 'north', orderId: 'u1' } });
    await create({ role: CHECK, metadata: { destination: 'north', orderId: 'u2' } });
    await create({ role: CHECK, metadata: { destination: 'south', orderId: 'u3' } });
    await create({ role: CHECK, metadata: { destination: 7, orderId: 'u4' } });
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [ids]);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('counts items and splits them by the reciprocal row facet', async () => {
    const { aggregates: agg, roles } = await escalationService.aggregateRelatedItems({
      hostIds: [binA, binB], scope: GLOBAL, splitBy: 'reciprocal.metadata.serviceLevel',
    });
    expect(agg[binA]).toEqual({ count: 3, splits: { standard: 2, express: 1 } });
    expect(agg[binB]).toEqual({ count: 0, splits: {} });
    expect(roles).toEqual([STAGE]);
  });

  it('splits by item payload, including batch entries', async () => {
    const { aggregates: agg, roles } = await escalationService.aggregateRelatedItems({
      hostIds: [binA, batch], scope: GLOBAL, splitBy: 'payload.tool',
    });
    expect(roles).toEqual([]);
    expect(agg[batch]).toEqual({ count: 1, splits: { saw: 1 } });
    expect(agg[binA]).toEqual({ count: 3, splits: { '': 3 } });
  });

  it('reports reciprocal rows outside the scope as hidden', async () => {
    const scope = { visibleRoles: [BIN], selfRoles: [], meUserId: VIEWER };
    const { aggregates: agg, roles } = await escalationService.aggregateRelatedItems({
      hostIds: [binA], scope, splitBy: 'reciprocal.metadata.serviceLevel',
    });
    expect(agg[binA]).toEqual({ count: 3, splits: {}, hidden: 3 });
    expect(roles).toEqual([]);
    const unsplit = await escalationService.aggregateRelatedItems({ hostIds: [binA], scope });
    expect(unsplit.aggregates[binA]).toEqual({ count: 3 });
  });

  it('lists items in fill order with their reciprocal rows', async () => {
    const { rows, total } = await escalationService.listRelatedItems({ hostId: binA, scope: GLOBAL, limit: 2 });
    expect(total).toBe(3);
    expect(rows.map((r) => r.item!.itemKey)).toEqual([`o1-${RUN}`, `o2-${RUN}`]);
    expect(rows[0].escalation).toMatchObject({ role: STAGE, metadata: { serviceLevel: 'standard' } });
    const batchRows = await escalationService.listRelatedItems({ hostId: batch, scope: GLOBAL, limit: 5 });
    expect(batchRows.rows[0]).toMatchObject({ item: { itemKey: 'cut', payload: { tool: 'saw' } }, escalation: null });
    expect(batchRows.rows[0].item!.at).toBeTruthy();
  });

  it('counts rows sharing each host facet, by role, keeping the facet type', async () => {
    const hosts = [
      { hostId: binA, match: { destination: 'north' } },
      { hostId: binB, match: { destination: 7 } },
    ];
    const agg = await escalationService.aggregateRelatedQuery({
      hosts, roles: [PREP, CHECK], status: 'pending', scope: GLOBAL, splitBy: 'role',
    });
    expect(agg[binA]).toEqual({ count: 2, splits: { [PREP]: 1, [CHECK]: 1 } });
    expect(agg[binB]).toEqual({ count: 1, splits: { [CHECK]: 1 } });
  });

  it('scopes query sets and lists rows in role order', async () => {
    const scope = { visibleRoles: [CHECK], selfRoles: [], meUserId: VIEWER };
    const agg = await escalationService.aggregateRelatedQuery({
      hosts: [{ hostId: binA, match: { destination: 'north' } }], roles: [PREP, CHECK], status: 'pending', scope,
    });
    expect(agg[binA]).toEqual({ count: 1 });
    const { rows, total } = await escalationService.listRelatedQueryRows({
      hosts: [{ hostId: binA, match: { destination: 'north' } }], roles: [PREP, CHECK], status: 'pending', scope: GLOBAL, limit: 10,
    });
    expect(total).toBe(2);
    expect(rows.map((r) => (r.escalation as any).role)).toEqual([PREP, CHECK]);
  });

  it('reads hosts of one role under the scope', async () => {
    expect(await escalationService.readRelatedHosts({ ids: [binA, batch], role: BIN, scope: GLOBAL })).toHaveLength(2);
    expect(await escalationService.readRelatedHosts({ ids: [binA], role: STAGE, scope: GLOBAL })).toHaveLength(0);
    const outside = { visibleRoles: [CHECK], selfRoles: [], meUserId: VIEWER };
    expect(await escalationService.readRelatedHosts({ ids: [binA], role: BIN, scope: outside })).toHaveLength(0);
  });
});
