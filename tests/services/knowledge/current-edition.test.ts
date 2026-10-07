import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import * as knowledge from '../../../system/activities/knowledge';
import { resolveLookupRefs } from '../../../services/knowledge';

const DOMAIN = 'test-kb-current';

// A ref with no version follows the newest edition; read as of a moment, it
// is the newest edition written by then.
describe('current lookup refs against real editions', () => {
  let client: Postgres;
  let betweenV1AndV2: string;

  beforeAll(async () => {
    client = new Postgres(postgres_options);
    await client.connect();
    await migrate();
    await client.query('DELETE FROM lt_knowledge WHERE domain = $1', [DOMAIN]);
    await knowledge.storeKnowledge({ domain: DOMAIN, key: 'tables', data: { items: ['t1'] } });
    await client.query(
      `UPDATE lt_knowledge_versions SET created_at = NOW() - interval '1 hour' WHERE domain = $1 AND version = 1`,
      [DOMAIN],
    );
    betweenV1AndV2 = new Date(Date.now() - 30 * 60_000).toISOString();
    await knowledge.storeKnowledge({ domain: DOMAIN, key: 'tables', data: { items: ['t1', 't2'] } });
  });

  afterAll(async () => {
    await client.query('DELETE FROM lt_knowledge WHERE domain = $1', [DOMAIN]);
    await client.end();
  });

  it('reads the newest edition now', async () => {
    const [now] = await resolveLookupRefs([{ domain: DOMAIN, key: 'tables' }]);
    expect(now).toMatchObject({ version: 2, current: true, data: { items: ['t1', 't2'] } });
  });

  it('reads the edition current at an earlier moment', async () => {
    const [then] = await resolveLookupRefs([{ domain: DOMAIN, key: 'tables', version: 'current' }], betweenV1AndV2);
    expect(then).toMatchObject({ version: 1, data: { items: ['t1'] } });
  });

  it('a pinned ref is unchanged by newer editions', async () => {
    const [pinned] = await resolveLookupRefs([{ domain: DOMAIN, key: 'tables', version: 1 }]);
    expect(pinned).toEqual({ domain: DOMAIN, key: 'tables', version: 1, data: { items: ['t1'] } });
  });

  it('a moment before any edition finds none', async () => {
    const [none] = await resolveLookupRefs([{ domain: DOMAIN, key: 'tables' }], '2000-01-01T00:00:00.000Z');
    expect(none).toMatchObject({ version: null, missing: true });
  });
});
