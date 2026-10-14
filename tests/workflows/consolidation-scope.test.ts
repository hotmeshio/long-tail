import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { getRelatedAggregates, getRelatedRows } from '../../api/escalations/related';
import { getPool } from '../../lib/db';
import { CONSOLIDATION_ROLES as R, SERVICE_LEVELS } from '../../examples/workflows/consolidation';
import { ConsolidationFloor } from '../helpers/consolidation-floor';
import type { LTEscalationRecord } from '../../types';

const HOLDS = 'reciprocal.metadata.serviceLevel';
const member = (role: string) => ({ role, type: 'member', read_scope: 'all', write_scope: 'all' });

// Related sets read under the viewer's own scope: a viewer sees the counts
// of roles they read, a total without a split they cannot read, nothing of a
// host role outside their scope, and a page costs the same however many
// rows it holds.
describe('consolidation: related sets under the viewer scope', () => {
  const floor = new ConsolidationFloor('test-consolidation-scope');
  const bins: LTEscalationRecord[] = [];
  let packer: string;
  let outsider: string;

  beforeAll(async () => {
    await floor.open();
    const north = floor.dest('north');
    for (const key of ['C1', 'C2', 'C3', 'C4']) bins.push(await floor.bin(key, north));
    const placed = await floor.order('p1', north, SERVICE_LEVELS.EXPRESS);
    await floor.walk(placed);
    await floor.place(placed, bins[0]);
    await floor.order('p2', north, SERVICE_LEVELS.STANDARD);
    const checking = await floor.order('p3', north, SERVICE_LEVELS.STANDARD);
    await floor.advance(checking, R.PREP, R.CHECK);
    packer = await floor.user([member(R.BIN), member(R.CHECK)]);
    outsider = await floor.user([member(R.CHECK)]);
  }, 90_000);

  afterAll(() => floor.close(), 30_000);

  it('counts only the roles the viewer reads and names the rest', async () => {
    const result = await getRelatedAggregates({ role: R.BIN, ids: [bins[0].id] }, { userId: packer });
    const coming = result.data.sets.coming;
    expect(coming.restricted).toEqual([R.PREP, R.STAGE]);
    expect(coming.aggregates.role[bins[0].id]).toEqual({ count: 1, splits: { [R.CHECK]: 1 } });

    const all = await getRelatedAggregates({ role: R.BIN, ids: [bins[0].id] }, floor.auth);
    expect(all.data.sets.coming.restricted).toEqual([]);
    expect(all.data.sets.coming.aggregates.role[bins[0].id]).toEqual({ count: 2, splits: { [R.PREP]: 1, [R.CHECK]: 1 } });
  }, 30_000);

  it('holds the total without a split the viewer cannot read', async () => {
    const result = await getRelatedAggregates({ role: R.BIN, ids: [bins[0].id] }, { userId: packer });
    expect(result.data.sets.contents.aggregates[HOLDS][bins[0].id]).toEqual({ count: 1, splits: {}, hidden: 1 });
    const rows = await getRelatedRows({ role: R.BIN, id: bins[0].id, set: 'contents' }, { userId: packer });
    expect(rows.data.rows).toHaveLength(1);
    expect(rows.data.rows[0].escalation).toBeNull();
    expect(rows.data.rows[0].item.reciprocalId).toBeTruthy();
  }, 30_000);

  it('a host role outside the viewer scope is not found', async () => {
    expect((await getRelatedAggregates({ role: R.BIN, ids: [bins[0].id] }, { userId: outsider })).status).toBe(404);
    expect((await getRelatedRows({ role: R.BIN, id: bins[0].id, set: 'coming' }, { userId: outsider })).status).toBe(404);
  }, 30_000);

  it('a page costs the same statements whatever its size', async () => {
    const pool = getPool();
    const count = async (ids: string[]) => {
      const spy = vi.spyOn(pool, 'query');
      await getRelatedAggregates({ role: R.BIN, ids }, floor.auth);
      const n = spy.mock.calls.length;
      spy.mockRestore();
      return n;
    };
    const one = await count([bins[0].id]);
    const four = await count(bins.map((b) => b.id));
    expect(four).toBe(one);
  }, 30_000);
});
