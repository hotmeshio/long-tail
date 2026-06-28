import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as escalationService from '../../../services/escalation';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// resolveEscalation(metadata) — record the outcome onto the row (HotMesh ≥0.24.0)
//
// A row is created carrying INTENT (what work was asked for). Resolving it merges
// an outcome patch into the SAME row's GIN-indexed metadata in one atomic UPDATE —
// "what actually happened" sits next to "what was intended", both @>-queryable.
// This is the surface the print farm leans on to record print duration + outcome.
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEscalation — metadata patch merges the outcome onto the row', () => {
  const ROLE = `resolve-meta-${Durable.guid()}`;
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

  async function metadataOf(id: string): Promise<Record<string, any>> {
    const { getPool } = await import('../../../lib/db');
    const { rows } = await getPool().query('SELECT metadata, status FROM lt_escalations WHERE id = $1', [id]);
    return rows[0];
  }

  it('merges the outcome patch into the existing metadata (intent preserved)', async () => {
    const created = await escalationService.createEscalation({
      type: 'print-meta-test',
      role: ROLE,
      description: 'intent row',
      metadata: { intended: true, stage: 'printing', orderId: 'order-1' },
    });
    ids.push(created.id);

    const resolved = await escalationService.resolveEscalation(
      created.id,
      { result: 'success' }, // resolverPayload — delivered to a waiter, NOT indexed
      { outcome: 'success', durationMs: 1234, unitsPrinted: 6 }, // metadata patch — indexed
    );
    expect(resolved).not.toBeNull();

    const row = await metadataOf(created.id);
    expect(row.status).toBe('resolved');
    // Intent preserved (merge, not replace) …
    expect(row.metadata.intended).toBe(true);
    expect(row.metadata.orderId).toBe('order-1');
    // … and the outcome recorded alongside it.
    expect(row.metadata.outcome).toBe('success');
    expect(row.metadata.durationMs).toBe(1234);
    expect(row.metadata.unitsPrinted).toBe(6);
  });

  it('resolves without a patch (metadata untouched) — backward compatible', async () => {
    const created = await escalationService.createEscalation({
      type: 'print-meta-test',
      role: ROLE,
      description: 'no-patch row',
      metadata: { intended: true },
    });
    ids.push(created.id);

    await escalationService.resolveEscalation(created.id, { result: 'success' });

    const row = await metadataOf(created.id);
    expect(row.status).toBe('resolved');
    expect(row.metadata).toEqual({ intended: true });
  });
});
