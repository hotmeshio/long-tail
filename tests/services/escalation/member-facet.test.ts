import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as escalationService from '../../../services/escalation';

const { Connection } = Durable;

// A list-valued facet is located by any one of its members: containment on a
// one-item list (metadata @> {facet: [member]}) finds the row, through the
// same search and claim paths a scan takes.

describe('list-valued facets match by membership', () => {
  const ROLE = `member-facet-${Durable.guid()}`;
  const ids: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const { getPool } = await import('../../../lib/db');
    await getPool().query('DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])', [ids]);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  const parcel = async (trackingNumbers: string[]) => {
    const row = await escalationService.createEscalation({
      type: 'member-facet-test', role: ROLE, description: 'parcel', metadata: { trackingNumbers },
    });
    ids.push(row.id);
    return row;
  };

  it('finds a row by either member of its list', async () => {
    const row = await parcel(['T-A', 'T-B']);
    for (const member of ['T-A', 'T-B']) {
      const { escalations } = await escalationService.searchByFacets({
        roles: [ROLE], facets: { trackingNumbers: [member] }, status: 'pending', limit: 5,
      });
      expect(escalations.map((e) => e.id)).toEqual([row.id]);
    }
  });

  it('a scalar value never matches a list facet', async () => {
    await parcel(['T-C']);
    const { escalations } = await escalationService.searchByFacets({
      roles: [ROLE], facets: { trackingNumbers: 'T-C' }, status: 'pending', limit: 5,
    });
    expect(escalations).toEqual([]);
  });

  it('claims a row by one member of its list', async () => {
    const row = await parcel(['T-D', 'T-E']);
    const claimed = await escalationService.claimByMetadata('trackingNumbers', ['T-E'], 'member-user', 5, undefined, [ROLE]);
    expect(claimed?.escalation?.id).toBe(row.id);
  });
});
