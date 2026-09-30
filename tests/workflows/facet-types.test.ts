import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../setup';
import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import * as escalationService from '../../services/escalation';

const { Connection } = Durable;

// A box and its slots share a role and a facet; type and subtype tell them apart.
const ROLE = `filling-${randomUUID().slice(0, 8)}`;
const BOX_KEY = `B-${randomUUID()}`;

const park = (type: string, subtype: string) => escalationService.createEscalation({
  type, subtype, role: ROLE, envelope: '{}', metadata: { boxKey: BOX_KEY },
});

describe('searchByFacets narrows by type and subtype', () => {
  let box: string;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    box = (await park('matchBox', 'box')).id;
    await park('matchSlot', 'slot');
    await park('matchSlot', 'slot');
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE role = $1', [ROLE]);
    await Durable.shutdown();
  }, 15_000);

  it('without a type filter every row sharing the facet matches', async () => {
    const result = await escalationService.searchByFacets({ role: ROLE, facets: { boxKey: BOX_KEY } });
    expect(result.total).toBe(3);
  });

  it('types keeps only the box, and the total agrees', async () => {
    const result = await escalationService.searchByFacets({ role: ROLE, types: ['matchBox'], facets: { boxKey: BOX_KEY } });
    expect(result.total).toBe(1);
    expect(result.escalations.map((e) => e.id)).toEqual([box]);
  });

  it('subtypes narrows the same way', async () => {
    const result = await escalationService.searchByFacets({ role: ROLE, subtypes: ['slot'], facets: { boxKey: BOX_KEY } });
    expect(result.total).toBe(2);
    expect(result.escalations.every((e) => e.subtype === 'slot')).toBe(true);
  });
});
