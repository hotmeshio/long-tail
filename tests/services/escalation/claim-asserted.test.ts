import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as escalationService from '../../../services/escalation';

const { Connection } = Durable;
const CODE = `SHELF-${Date.now()}`;
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';

// Several pending rows share one code; the asserted claim writes only the
// named row, under the same conditions a claim by code applies.
describe('claimAssertedByMetadata against real rows', () => {
  const ids: string[] = [];
  const make = async (role: string, subtype: string, priority: number) => {
    const row = await escalationService.createEscalation({
      type: 'shelf', subtype, role, priority, metadata: { binCode: CODE },
    } as any);
    ids.push(row.id);
    return row.id;
  };
  let first: string;
  let open: string;
  let other: string;

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    first = await make('shelf', 'packing', 1);
    open = await make('shelf', 'open', 2);
    other = await make('audit', 'open', 2);
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])', [ids]);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('claims the named row, not the highest-priority row with the code', async () => {
    const result = await escalationService.claimAssertedByMetadata(open, 'binCode', CODE, USER_A, 30, { scannedBy: 'a' }, ['shelf']);
    expect(result).toMatchObject({ escalation: { id: open, assigned_to: USER_A }, isExtension: false });
    expect(result!.escalation.metadata).toMatchObject({ binCode: CODE, scannedBy: 'a' });
    const firstRow = await escalationService.getEscalation(first);
    expect(firstRow!.assigned_to).toBeNull();
  });

  it('extends the same claimant and refuses another', async () => {
    const again = await escalationService.claimAssertedByMetadata(open, 'binCode', CODE, USER_A, 30, undefined, null);
    expect(again?.isExtension).toBe(true);
    expect(await escalationService.claimAssertedByMetadata(open, 'binCode', CODE, USER_B, 30, undefined, null)).toBeNull();
  });

  it('refuses a row outside the allowed roles or without the code', async () => {
    expect(await escalationService.claimAssertedByMetadata(other, 'binCode', CODE, USER_A, 30, undefined, ['shelf'])).toBeNull();
    expect(await escalationService.claimAssertedByMetadata(first, 'binCode', 'SHELF-OTHER', USER_A, 30, undefined, null)).toBeNull();
    expect((await escalationService.getEscalation(other))!.assigned_to).toBeNull();
  });

  it('refuses a row that left pending, and a non-uuid id', async () => {
    await escalationService.cancelEscalation(first);
    expect(await escalationService.claimAssertedByMetadata(first, 'binCode', CODE, USER_A, 30, undefined, null)).toBeNull();
    expect(await escalationService.claimAssertedByMetadata('not-a-uuid', 'binCode', CODE, USER_A, 30, undefined, null)).toBeNull();
  });
});
