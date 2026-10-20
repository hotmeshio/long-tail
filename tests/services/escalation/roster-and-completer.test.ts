import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { escalations } from '../../../services/escalation/client';
import * as escalationService from '../../../services/escalation';
import { loadRosterCounts } from '../../../services/escalation/roster';

const { Connection } = Durable;
const PACKER = '55555555-5555-4555-8555-555555555555';
const STAMP = `${Date.now()}`;

// A box expecting three orders against real rows: one packed in by a
// reciprocal add, one resolved as missing on its own row, one still waiting.
describe('roster counts and the completer stamp against real rows', () => {
  const ids: string[] = [];
  let boxId = '';
  const orderIds = [`o-${STAMP}-1`, `o-${STAMP}-2`, `o-${STAMP}-3`];
  const members: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    const client = await escalations();
    const box = await client.create({ role: 'roster-box', metadata: { boxKey: STAMP }, accumulate: { max: 3, resolveAtMax: false } });
    boxId = box.id;
    ids.push(box.id);
    for (const orderId of orderIds) {
      const row = await client.create({ role: 'roster-member', metadata: { orderId, box: box.id }, accumulate: { max: 1 } });
      members.push(row.id);
      ids.push(row.id);
    }
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [ids]);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('records who completed the member row of a reciprocal add', async () => {
    const result = await escalationService.accumulateItem(boxId, {
      itemKey: orderIds[0],
      metadata: { resolved_by: PACKER },
      reciprocal: { id: members[0], metadata: { resolved_by: PACKER } },
    });
    expect(result.outcome).toBe('accepted');
    expect(result.reciprocal?.outcome).toBe('completed');
    const member = await escalationService.getEscalation(members[0]);
    expect(member?.status).toBe('resolved');
    expect((member?.metadata as any).resolved_by).toBe(PACKER);
  });

  it('finds the completer’s recent work by facet, newest first', async () => {
    const { escalations: rows } = await escalationService.searchEscalationsFaceted({
      global: true,
      facet: {
        status: 'resolved',
        facets: { resolved_by: PACKER },
        orderBy: [{ field: 'resolved_at', direction: 'desc' }],
      },
      limit: 10,
      offset: 0,
    });
    expect(rows.map((r) => r.id)).toContain(members[0]);
  });

  it('counts the roster from the box and its member rows', async () => {
    await escalationService.resolveEscalation(members[1], { outcome: 'missing' });
    const box = await escalationService.getEscalation(boxId);
    const schema = {
      properties: {
        orders: {
          'x-lt-roster': {
            expected: { query: { role: 'roster-member', facets: { box: '{{escalation.id}}' } } },
            key: '{{metadata.orderId}}',
            flagged: [{ when: 'resolver.outcome=missing', label: 'Missing' }],
          },
        },
      },
    };
    const counts = await loadRosterCounts(schema, {
      escalation: box as unknown as Record<string, unknown>,
      metadata: box!.metadata as Record<string, unknown>,
    });
    expect(counts.orders).toEqual({ expected: 3, in: 1, flagged: 1, waiting: 1, outstanding: 1 });
  });
});
