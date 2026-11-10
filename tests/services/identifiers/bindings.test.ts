import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { upsertScanScheme } from '../../../services/scan-code';
import { BOUND_VIA, bind, listBindings, rebind, resolveBinding, retire } from '../../../services/identifiers';

// Bindings against Postgres: the partial unique indexes decide every race.

const CARTRIDGE = 86;
const PLATE = 87;
const API = { via: BOUND_VIA.API };

describe('identifier bindings', () => {
  beforeAll(async () => {
    await migrate();
    await upsertScanScheme({ version: CARTRIDGE, name: 'Cartridge', target_facet: 'materialId', encoding: 'delimited' });
    await upsertScanScheme({ version: PLATE, name: 'Plate', target_facet: 'serialNumber', encoding: 'delimited', identifier: { exclusiveTarget: true } });
  }, 30_000);
  beforeEach(async () => {
    await getPool().query('DELETE FROM lt_identifier_bindings WHERE scheme_version = ANY($1)', [[CARTRIDGE, PLATE]]);
  });
  afterAll(async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE version = ANY($1)', [[CARTRIDGE, PLATE]]);
  });

  it('a raw binds to one target; binding it elsewhere is refused, and the same pair again is already bound', async () => {
    const first = await bind(CARTRIDGE, 'CART-1', 'LOT-7', API);
    expect(first).toMatchObject({ already: false, binding: { raw: 'CART-1', target: 'LOT-7', bound_via: 'api', exclusive: false } });
    await expect(bind(CARTRIDGE, 'CART-1', 'LOT-8', API)).rejects.toMatchObject({ status: 409 });
    expect(await bind(CARTRIDGE, 'CART-1', 'LOT-7', API)).toMatchObject({ already: true, binding: { id: first.binding.id } });
    expect(await resolveBinding(CARTRIDGE, 'CART-1')).toMatchObject({ target: 'LOT-7' });
  });

  it('concurrent binds of one raw: exactly one wins', async () => {
    const outcomes = await Promise.allSettled(['A', 'B', 'C', 'D'].map((t) => bind(CARTRIDGE, 'CART-2', `LOT-${t}`, API)));
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await listBindings(CARTRIDGE, { raw: 'CART-2' })).toHaveLength(1);
  });

  it('a target holds many raws unless the scheme makes it exclusive', async () => {
    await bind(CARTRIDGE, 'CART-3', 'LOT-9', API);
    await bind(CARTRIDGE, 'CART-4', 'LOT-9', API);
    expect(await listBindings(CARTRIDGE, { target: 'LOT-9' })).toHaveLength(2);
    await bind(PLATE, 'PLATE-1', 'P1S-01', API);
    const swapped = await bind(PLATE, 'PLATE-2', 'P1S-01', API);
    expect(swapped.retired.map((r) => r.raw)).toEqual(['PLATE-1']);
    expect((await listBindings(PLATE, { target: 'P1S-01' })).map((b) => b.raw)).toEqual(['PLATE-2']);
  });

  it('concurrent binds onto one exclusive target leave one live raw', async () => {
    await Promise.allSettled(['X', 'Y', 'Z'].map((p) => bind(PLATE, `PLATE-${p}`, 'P1S-02', API)));
    expect(await listBindings(PLATE, { target: 'P1S-02' })).toHaveLength(1);
  });

  it('a rebind retires the raw\'s old binding and keeps it as history', async () => {
    await bind(CARTRIDGE, 'CART-5', 'LOT-1', API);
    const moved = await rebind(CARTRIDGE, 'CART-5', 'LOT-2', API);
    expect(moved.retired.map((r) => r.target)).toEqual(['LOT-1']);
    expect(await resolveBinding(CARTRIDGE, 'CART-5')).toMatchObject({ target: 'LOT-2' });
    const history = await listBindings(CARTRIDGE, { raw: 'CART-5', includeRetired: true });
    expect(history.map((b) => [b.target, b.retired_at === null])).toEqual([['LOT-2', true], ['LOT-1', false]]);
  });

  it('a rebind onto an exclusive target retires the raw\'s old target and the target\'s old raw', async () => {
    await bind(PLATE, 'PLATE-A', 'P1S-03', API);
    await bind(PLATE, 'PLATE-B', 'P1S-04', API);
    const moved = await rebind(PLATE, 'PLATE-A', 'P1S-04', API);
    expect(moved.retired.map((r) => r.raw).sort()).toEqual(['PLATE-A', 'PLATE-B']);
    expect((await listBindings(PLATE)).map((b) => [b.raw, b.target])).toEqual([['PLATE-A', 'P1S-04']]);
  });

  it('retire ends one live binding; the raw is then free and its history kept', async () => {
    const { binding } = await bind(CARTRIDGE, 'CART-6', 'LOT-3', API);
    expect(await retire(CARTRIDGE, binding.id, API)).toMatchObject({ id: binding.id });
    expect(await retire(CARTRIDGE, binding.id, API)).toBeNull();
    expect(await resolveBinding(CARTRIDGE, 'CART-6')).toBeNull();
    await bind(CARTRIDGE, 'CART-6', 'LOT-4', API);
    expect(await listBindings(CARTRIDGE, { raw: 'CART-6', includeRetired: true })).toHaveLength(2);
  });

  it('records who bound only when it is a user id, and refuses bad input or an unknown scheme', async () => {
    const user = '00000000-0000-4000-8000-000000000001';
    expect((await bind(CARTRIDGE, 'CART-7', 'LOT-5', { userId: user, via: BOUND_VIA.SCAN })).binding).toMatchObject({ bound_by: user, bound_via: 'scan' });
    expect((await bind(CARTRIDGE, 'CART-8', 'LOT-5', { userId: 'not-a-uuid', via: BOUND_VIA.API })).binding.bound_by).toBeNull();
    await expect(bind(CARTRIDGE, '', 'LOT-5', API)).rejects.toMatchObject({ status: 400 });
    await expect(bind(CARTRIDGE, 'CART-9', 'x'.repeat(65), API)).rejects.toMatchObject({ status: 400 });
    await expect(bind(55, 'CART-9', 'LOT-5', API)).rejects.toMatchObject({ status: 404 });
  });
});
