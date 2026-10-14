import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getRelatedAggregates, getRelatedRows } from '../../api/escalations/related';
import { listEscalations } from '../../api/escalations/list';
import { removeItem } from '../../api/escalations/accumulate';
import { claimEscalation } from '../../api/escalations/claim';
import { escalations } from '../../services/escalation/client';
import { CONSOLIDATION_ROLES as R, SERVICE_LEVELS } from '../../examples/workflows/consolidation';
import { ConsolidationFloor } from '../helpers/consolidation-floor';
import type { LTEscalationRecord } from '../../types';

const HOLDS = 'reciprocal.metadata.serviceLevel';

// A floor in motion, read through the container list's related sets: what
// each bin holds by service level, and what is coming toward it by station,
// as orders walk the stations and land in their bins.
describe('consolidation: the container list reads the floor', () => {
  const floor = new ConsolidationFloor('test-consolidation-views');
  let north: string;
  let south: string;
  let tubStandard: LTEscalationRecord;
  let tubExpress: LTEscalationRecord;
  let southBin: LTEscalationRecord;
  const orders: string[] = [];

  const read = async (ids: string[]) => {
    const result = await getRelatedAggregates({ role: R.BIN, ids }, floor.auth);
    expect(result.status).toBe(200);
    return result.data.sets;
  };

  beforeAll(async () => {
    await floor.open();
    north = floor.dest('north');
    south = floor.dest('south');
    tubStandard = await floor.bin('A3', north, SERVICE_LEVELS.STANDARD);
    tubExpress = await floor.bin('A3', north, SERVICE_LEVELS.EXPRESS);
    southBin = await floor.bin('B1', south);
    orders.push(await floor.order('o1', north, SERVICE_LEVELS.STANDARD));
    orders.push(await floor.order('o2', north, SERVICE_LEVELS.STANDARD));
    orders.push(await floor.order('o3', north, SERVICE_LEVELS.EXPRESS));
    orders.push(await floor.order('o4', south, SERVICE_LEVELS.STANDARD));
  }, 90_000);

  afterAll(() => floor.close(), 30_000);

  it('everything starts upstream: each lane sees its own service level, a bin without lanes the whole destination', async () => {
    const sets = await read([tubStandard.id, tubExpress.id, southBin.id]);
    expect(sets.coming.roles).toEqual([R.PREP, R.CHECK, R.STAGE]);
    expect(sets.coming.aggregates.role[tubStandard.id]).toEqual({ count: 2, splits: { [R.PREP]: 2 } });
    expect(sets.coming.aggregates.role[tubExpress.id]).toEqual({ count: 1, splits: { [R.PREP]: 1 } });
    expect(sets.coming.aggregates.role[southBin.id]).toEqual({ count: 1, splits: { [R.PREP]: 1 } });
    expect(sets.contents.aggregates[HOLDS][tubStandard.id]).toEqual({ count: 0, splits: {} });
  }, 30_000);

  it('an order finishing a station moves between the coming splits', async () => {
    await floor.advance(orders[0], R.PREP, R.CHECK);
    const sets = await read([tubStandard.id]);
    expect(sets.coming.aggregates.role[tubStandard.id]).toEqual({ count: 2, splits: { [R.PREP]: 1, [R.CHECK]: 1 } });
  }, 30_000);

  it('a claimed upstream row still counts as coming', async () => {
    const prep = await floor.waitFor(`${R.PREP}-${orders[3]}`);
    const claim = await claimEscalation({ id: prep.id }, floor.auth);
    expect(claim.status).toBe(200);
    const sets = await read([southBin.id]);
    expect(sets.coming.aggregates.role[southBin.id]).toEqual({ count: 1, splits: { [R.PREP]: 1 } });
    const rows = await getRelatedRows({ role: R.BIN, id: southBin.id, set: 'coming' }, floor.auth);
    expect(rows.data.rows[0].escalation).toMatchObject({ id: prep.id, assigned_to: floor.operatorId });
  }, 30_000);

  it('placed orders leave coming and are held, split by service level', async () => {
    await floor.advance(orders[0], R.CHECK, R.STAGE);
    await floor.walk(orders[1]);
    await floor.walk(orders[2]);
    let sets = await read([tubStandard.id, tubExpress.id]);
    expect(sets.coming.aggregates.role[tubStandard.id]).toEqual({ count: 2, splits: { [R.STAGE]: 2 } });
    expect(sets.coming.aggregates.role[tubExpress.id]).toEqual({ count: 1, splits: { [R.STAGE]: 1 } });

    await floor.place(orders[0], tubStandard);
    await floor.place(orders[1], tubStandard);
    await floor.place(orders[2], tubExpress);
    sets = await read([tubStandard.id, tubExpress.id]);
    expect(sets.contents.aggregates[HOLDS][tubStandard.id]).toEqual({ count: 2, splits: { standard: 2 } });
    expect(sets.contents.aggregates[HOLDS][tubExpress.id]).toEqual({ count: 1, splits: { express: 1 } });
    expect(sets.coming.aggregates.role[tubStandard.id]).toEqual({ count: 0, splits: {} });
  }, 60_000);

  it('a bin expands to its orders, each with the order row it opens', async () => {
    const result = await getRelatedRows({ role: R.BIN, id: tubStandard.id, set: 'contents' }, floor.auth);
    expect(result.status).toBe(200);
    expect(result.data.total).toBe(2);
    expect(result.data.rows.map((r: any) => r.item.itemKey)).toEqual([orders[0], orders[1]]);
    expect(result.data.rows[0].escalation).toMatchObject({ role: R.STAGE, metadata: { orderId: orders[0], serviceLevel: 'standard' } });

    const lane = await getRelatedRows({ role: R.BIN, id: tubExpress.id, set: 'coming' }, floor.auth);
    expect(lane.data.total).toBe(0);
    const coming = await getRelatedRows({ role: R.BIN, id: southBin.id, set: 'coming' }, floor.auth);
    expect(coming.data.rows.map((r: any) => [r.escalation.role, r.escalation.metadata.orderId])).toEqual([[R.PREP, orders[3]]]);
  }, 30_000);

  it('a removed order leaves the count', async () => {
    const result = await removeItem({ id: tubStandard.id, itemKey: orders[1] } as any, floor.auth);
    expect(result.status).toBe(200);
    const sets = await read([tubStandard.id]);
    expect(sets.contents.aggregates[HOLDS][tubStandard.id]).toEqual({ count: 1, splits: { standard: 1 } });
  }, 30_000);

  it('a held order whose own row changes moves the split, and the set names that row role to follow', async () => {
    const member = await floor.waitFor(`stage-${orders[0]}`, 'resolved');
    await (await escalations()).update({ id: member.id, metadata: { serviceLevel: SERVICE_LEVELS.EXPRESS } });
    const sets = await read([tubStandard.id]);
    expect(sets.contents.aggregates[HOLDS][tubStandard.id]).toEqual({ count: 1, splits: { express: 1 } });
    expect(sets.contents.roles).toEqual([R.STAGE]);
  }, 30_000);

  it('the tub reads as one group of its lanes, a page never splitting a group', async () => {
    const page = await listEscalations(
      { role: R.BIN, status: 'pending', facets: { destination: north }, groupBy: 'binKey', limit: 1 },
      floor.auth,
    );
    expect(page.status).toBe(200);
    expect(page.data.total).toBe(1);
    expect(page.data.groups).toEqual([{ key: `A3-${floor.run}`, ids: expect.arrayContaining([tubStandard.id, tubExpress.id]) }]);
    expect(page.data.escalations).toHaveLength(2);
  }, 30_000);
});
