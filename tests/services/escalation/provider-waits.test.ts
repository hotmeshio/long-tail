import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { durableProviderRegistry, openWait } from '../../../services/durable-provider';
import { bulkResolveForTriage } from '../../../services/escalation/bulk';
import { createEscalation, getEscalation } from '../../../services/escalation/crud';
import { providerEscalationIdFor, withoutProviderWaits } from '../../../services/escalation/provider-waits';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

// Escalations a provider workflow waits on are found by signal key and are
// never resolved by triage.
vi.mock('../../../lib/events/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/events/publish')>()),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

const PROVIDER = 'provider-waits-test';
const CREATOR = '00000000-0000-4000-8000-0000000000cd';
const RUN = `pw-${Date.now()}`;

describe('provider waits in the escalation service', () => {
  let waitId: string;

  beforeAll(async () => {
    await Durable.Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    durableProviderRegistry.register(new FakeDurableProvider(PROVIDER));
    const { escalation } = await openWait(PROVIDER, {
      workflowId: `${RUN}-wf`, waitKey: 'review', role: 'reviewer', type: 'review', signalKey: `${RUN}-key`,
    }, CREATOR);
    waitId = escalation.id;
  }, 30_000);

  afterAll(async () => {
    durableProviderRegistry.clear();
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE provider = $1)`, [PROVIDER]);
    await pool.query('DELETE FROM lt_durable_waits WHERE provider = $1', [PROVIDER]);
    await Durable.shutdown();
  });

  it('finds a wait\'s escalation by its signal key', async () => {
    expect(await providerEscalationIdFor(`${RUN}-key`)).toBe(waitId);
    expect(await providerEscalationIdFor(`${RUN}-other`)).toBeNull();
  });

  it('queries nothing under HotMesh', async () => {
    const provider = durableProviderRegistry.current;
    durableProviderRegistry.clear();
    try {
      expect(await providerEscalationIdFor(`${RUN}-key`)).toBeNull();
      expect(await withoutProviderWaits([waitId])).toEqual([waitId]);
    } finally {
      durableProviderRegistry.register(provider);
    }
  });

  it('leaves a wait pending when triage resolves a set that includes it', async () => {
    const standalone = await createEscalation({ type: 'review', role: 'reviewer', description: RUN } as any);
    const triaged = await bulkResolveForTriage([waitId, standalone.id]);
    expect(triaged.map((row) => row.id)).toEqual([standalone.id]);
    expect((await getEscalation(waitId))?.status).toBe('pending');
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE id = $1', [standalone.id]);
  });
});
