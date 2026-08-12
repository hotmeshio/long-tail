import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { applyAgent, getAgent } from '../../../services/agent';
import {
  applySubscription,
  listSubscriptions,
} from '../../../services/agent/subscriptions';

// ─────────────────────────────────────────────────────────────────────────────
// Startup agent apply — declared fields (including status) follow code;
// runtime state and the subscription `enabled` kill-switch stay DB-owned.
// Undeclared subscriptions are reported by the boot pass, never deleted.
// ─────────────────────────────────────────────────────────────────────────────

const AGENT = `apply-agent-${Date.now()}`;
const TOPIC = 'apply.agent.test';

describe('agent service — startup apply', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM lt_agent_subscriptions WHERE agent_id = $1', [AGENT]);
    await pool.query('DELETE FROM lt_agents WHERE id = $1', [AGENT]);
  });

  it('registers a new agent, then no-ops on an identical apply', async () => {
    expect(await applyAgent({ id: AGENT, description: 'watches things', status: 'active', goals: 'observe' }))
      .toBe('applied');
    expect(await applyAgent({ id: AGENT, description: 'watches things', status: 'active', goals: 'observe' }))
      .toBe('unchanged');
  });

  it('applies changed declared fields, including status', async () => {
    expect(await applyAgent({ id: AGENT, description: 'watches things', status: 'inactive', goals: 'observe more' }))
      .toBe('applied');
    const stored = await getAgent(AGENT);
    expect(stored?.status).toBe('inactive');
    expect(stored?.goals).toBe('observe more');
  });

  it('subscription apply upserts reaction fields on (agent, topic)', async () => {
    expect(await applySubscription(AGENT, { topic: TOPIC, reaction_type: 'durable', workflow_type: 'flowA' }))
      .toBe('applied');
    expect(await applySubscription(AGENT, { topic: TOPIC, reaction_type: 'durable', workflow_type: 'flowA' }))
      .toBe('unchanged');
    expect(await applySubscription(AGENT, { topic: TOPIC, reaction_type: 'durable', workflow_type: 'flowB' }))
      .toBe('applied');

    const subs = await listSubscriptions(AGENT);
    expect(subs).toHaveLength(1);
    expect(subs[0].workflow_type).toBe('flowB');
  });

  it('an admin-disabled subscription stays disabled through an apply', async () => {
    await getPool().query(
      'UPDATE lt_agent_subscriptions SET enabled = false WHERE agent_id = $1 AND topic = $2',
      [AGENT, TOPIC],
    );
    // The reaction change applies; the kill-switch is honored.
    await applySubscription(AGENT, { topic: TOPIC, reaction_type: 'durable', workflow_type: 'flowC' });
    const subs = await listSubscriptions(AGENT);
    expect(subs[0].workflow_type).toBe('flowC');
    expect(subs[0].enabled).toBe(false);
  });
});
