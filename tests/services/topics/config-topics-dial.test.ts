import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { seedConfigTopics } from '../../../services/topics/system-topics';
import { getTopic } from '../../../services/topics';

// ─────────────────────────────────────────────────────────────────────────────
// Config topics — the global ownership dial. seedConfigTopics(topics, true)
// makes every entry code-owned (overwritten each boot) unless the entry opts
// back to db-owned with reset: false.
// ─────────────────────────────────────────────────────────────────────────────

const STAMP = Date.now();
const OWNED = `apply.topic.owned.${STAMP}`;
const OPTED_OUT = `apply.topic.opted-out.${STAMP}`;

describe('topics — configSource dial on seedConfigTopics', () => {
  beforeAll(async () => {
    await migrate();
    await seedConfigTopics([
      { topic: OWNED, description: 'first shape', category: 'app' },
      { topic: OPTED_OUT, description: 'first shape', category: 'app', reset: false },
    ], true);
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_topic_catalog WHERE topic = ANY($1)', [[OWNED, OPTED_OUT]]);
  });

  it('a code-owned topic is overwritten from config on the next boot', async () => {
    await seedConfigTopics([{ topic: OWNED, description: 'second shape', category: 'app' }], true);
    const stored = await getTopic(OWNED);
    expect(stored?.description).toBe('second shape');
    expect(stored?.managed).toBe(true);
  });

  it('reset: false opts an entry back to db-owned under the code dial', async () => {
    await seedConfigTopics([{ topic: OPTED_OUT, description: 'second shape', category: 'app', reset: false }], true);
    const stored = await getTopic(OPTED_OUT);
    expect(stored?.description).toBe('first shape');
    expect(stored?.managed).toBe(false);
  });
});
