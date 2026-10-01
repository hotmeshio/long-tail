import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../setup';
import { migrate } from '../../lib/db/migrate';
import { getPool } from '../../lib/db';
import * as escalationService from '../../services/escalation';

const { Connection } = Durable;

// The atomic resolve narrows its pick to a claim state inside the statement.
// Two bags for one clinic share a shelf facet: a resolve for "mine" lands on
// the actor's own live claim, never on a sibling row.
const ROLE = `binning-${randomUUID().slice(0, 8)}`;
const ASSOCIATE = randomUUID();
const OTHER = randomUUID();

async function park(binCode: string): Promise<string> {
  const row = await escalationService.createEscalation({
    type: 'binning', subtype: 'bag', role: ROLE, envelope: '{}', metadata: { binCode },
  });
  return row.id;
}

async function claim(id: string, userId: string): Promise<void> {
  expect(await escalationService.claimEscalation(id, userId, 30)).not.toBeNull();
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await getPool().query('SELECT status FROM public.hmsh_escalations WHERE id = $1', [id]);
  return rows[0].status;
}

const resolve = (binCode: string, userId: string, availability?: 'mine' | 'available' | 'claimed', assertId?: string) =>
  escalationService.resolveByMetadataAtomic(
    'binCode', binCode, userId, { outcome: 'placed' }, undefined, null, null, null, assertId ?? null, null, availability,
  );

describe('resolve by metadata honours the claim state (0a)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE role = $1', [ROLE]);
    await Durable.shutdown();
  }, 15_000);

  it('mine resolves the actor claim, not an older unclaimed sibling', async () => {
    const shelf = `S-${randomUUID()}`;
    const unclaimed = await park(shelf);
    const mine = await park(shelf);
    await claim(mine, ASSOCIATE);

    const result = await resolve(shelf, ASSOCIATE, 'mine');
    expect(result.outcome).toBe('resolved');
    expect(result.escalation?.id).toBe(mine);
    expect(await statusOf(unclaimed)).toBe('pending');
  });

  it('without a claim state the pick stays priority then age', async () => {
    const shelf = `S-${randomUUID()}`;
    const older = await park(shelf);
    const claimed = await park(shelf);
    await claim(claimed, ASSOCIATE);

    const result = await resolve(shelf, ASSOCIATE);
    expect(result.escalation?.id).toBe(older);
  });

  it('several of mine resolve the most recently claimed first', async () => {
    const shelf = `S-${randomUUID()}`;
    const first = await park(shelf);
    const second = await park(shelf);
    await claim(second, ASSOCIATE);
    await new Promise((r) => setTimeout(r, 20));
    await claim(first, ASSOCIATE);

    expect((await resolve(shelf, ASSOCIATE, 'mine')).escalation?.id).toBe(first);
  });

  it('mine misses when only someone else holds a claim, or the claim lapsed', async () => {
    const shelf = `S-${randomUUID()}`;
    const theirs = await park(shelf);
    const lapsed = await park(shelf);
    await claim(theirs, OTHER);
    await claim(lapsed, ASSOCIATE);
    await getPool().query(
      "UPDATE public.hmsh_escalations SET assigned_until = NOW() - INTERVAL '1 minute' WHERE id = $1", [lapsed],
    );

    expect((await resolve(shelf, ASSOCIATE, 'mine')).outcome).toBe('not_found');
    expect(await statusOf(theirs)).toBe('pending');
    expect(await statusOf(lapsed)).toBe('pending');
  });

  it('available skips a row someone else holds', async () => {
    const shelf = `S-${randomUUID()}`;
    const held = await park(shelf);
    const free = await park(shelf);
    await claim(held, OTHER);

    expect((await resolve(shelf, ASSOCIATE, 'available')).escalation?.id).toBe(free);
    expect(await statusOf(held)).toBe('pending');
  });

  it('an asserted row resolves only while it still matches the claim state', async () => {
    const shelf = `S-${randomUUID()}`;
    const shown = await park(shelf);
    await claim(shown, OTHER);

    expect((await resolve(shelf, ASSOCIATE, 'available', shown)).outcome).toBe('not_found');
    expect(await statusOf(shown)).toBe('pending');
  });
});
