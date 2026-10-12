import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { escalations } from '../../../services/escalation/client';
import * as escalationService from '../../../services/escalation';
import { ESCALATION_BATCH_KEYS } from '../../../types/escalation';

const { Connection } = Durable;
const USER = '44444444-4444-4444-8444-444444444444';
const CUT_AT = '2026-01-02T03:04:05.000Z';
const envelopeOf = (row: { envelope: unknown }) => JSON.parse(String(row.envelope));

// A batch row that starts with one entry filled, then filled through the
// service with an actor: progress counts the filled entry, each entry keeps
// its actor, and completion carries every payload.
describe('batch entry provenance against real rows', () => {
  const ids: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [ids]);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  it('starts with the filled entry and records each fill actor', async () => {
    const client = await escalations();
    const row = await client.create({
      role: 'assembly',
      metadata: { orderId: `ORD-${Date.now()}` },
      batch: ['cut', 'weld', 'paint'],
      filled: { cut: { payload: { ok: true }, at: CUT_AT, actor: 'legacy-user' } },
    });
    ids.push(row.id);
    expect((row.metadata as any)[ESCALATION_BATCH_KEYS.PENDING]).toEqual(['weld', 'paint']);

    const weld = await escalationService.resolveBatchItem(row.id, 'weld', { ok: true }, undefined, undefined, { id: USER }, USER);
    expect(weld.outcome).toBe('accepted');
    expect(weld.remaining).toBe(1);
    expect(envelopeOf(weld.escalation!)[ESCALATION_BATCH_KEYS.FILLED_BY]).toEqual({ cut: 'legacy-user', weld: USER });

    const paint = await escalationService.resolveBatchItem(row.id, 'paint', { ok: false }, undefined, undefined, { id: USER }, USER);
    expect(paint.outcome).toBe('completed');
    expect(JSON.parse(String(paint.escalation!.resolver_payload))).toEqual({ cut: { ok: true }, weld: { ok: true }, paint: { ok: false } });
    expect(envelopeOf(paint.escalation!)[ESCALATION_BATCH_KEYS.FILLED_AT].cut).toBe(CUT_AT);
  });
});
