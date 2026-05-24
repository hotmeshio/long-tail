import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { publishAgentEvent } from '../../lib/events/publish';
import type { LTAgent, LTAgentStats } from '../../types/agent';
import {
  LIST_AGENTS,
  COUNT_AGENTS,
  GET_AGENT,
  INSERT_AGENT,
  UPDATE_AGENT,
  DELETE_AGENT,
  SEED_AGENT,
  KNOWLEDGE_COUNT,
  ESCALATION_COUNT,
} from './sql';

interface ListAgentsFilters {
  status?: string;
  knowledge_domain?: string;
  limit?: number;
  offset?: number;
}

export async function listAgents(
  filters: ListAgentsFilters = {},
): Promise<{ agents: LTAgent[]; total: number }> {
  const pool = getPool();
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const status = filters.status ?? null;
  const domain = filters.knowledge_domain ?? null;

  const [dataRes, countRes] = await Promise.all([
    pool.query(LIST_AGENTS, [status, domain, limit, offset]),
    pool.query(COUNT_AGENTS, [status, domain]),
  ]);

  return {
    agents: dataRes.rows,
    total: countRes.rows[0]?.total ?? 0,
  };
}

export async function getAgent(id: string): Promise<LTAgent | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_AGENT, [id]);
  return rows[0] ?? null;
}

export async function createAgent(
  data: Partial<LTAgent> & { id: string },
): Promise<LTAgent> {
  const pool = getPool();
  const { rows } = await pool.query(INSERT_AGENT, [
    data.id,
    data.description ?? null,
    data.status ?? 'inactive',
    data.user_id ?? null,
    data.knowledge_domain ?? null,
    JSON.stringify(data.capabilities ?? []),
    JSON.stringify(data.behaviors ?? {}),
    data.goals ?? null,
    data.rules ?? null,
    data.workflow_type ?? null,
    data.pipeline_id ?? null,
    JSON.stringify(data.metadata ?? {}),
  ]);
  return rows[0];
}

export async function updateAgent(
  id: string,
  data: Partial<LTAgent>,
): Promise<LTAgent | null> {
  const pool = getPool();
  // Check current status before update for change detection
  const oldAgent = data.status ? await getAgent(id) : null;
  const { rows } = await pool.query(UPDATE_AGENT, [
    id,
    data.description ?? null,
    data.status ?? null,
    data.user_id ?? null,
    data.knowledge_domain ?? null,
    data.capabilities ? JSON.stringify(data.capabilities) : null,
    data.behaviors ? JSON.stringify(data.behaviors) : null,
    data.goals ?? null,
    data.rules ?? null,
    data.workflow_type ?? null,
    data.pipeline_id ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null,
    data.last_run_at ?? null,
  ]);
  const updated = rows[0] ?? null;
  if (updated && oldAgent && data.status && oldAgent.status !== updated.status) {
    publishAgentEvent({
      type: 'agent.status_changed',
      agentId: updated.id,
      agentName: updated.id,
      status: updated.status,
      data: { previous: oldAgent.status },
    });
  }
  // Restart event triggers and cron schedules if status or behaviors changed
  if (updated && (data.status || data.behaviors)) {
    import('./trigger-registry').then(({ agentTriggerRegistry }) =>
      agentTriggerRegistry.restartAgent(id),
    ).catch(() => {});
    import('../cron').then(({ cronRegistry }) =>
      cronRegistry.restartAgentCrons(updated),
    ).catch(() => {});
  }
  return updated;
}

export async function deleteAgent(id: string): Promise<boolean> {
  // Stop event triggers and cron schedules before deleting
  import('./trigger-registry').then(({ agentTriggerRegistry }) =>
    agentTriggerRegistry.stopAgent(id),
  ).catch(() => {});
  import('../cron').then(({ cronRegistry }) =>
    cronRegistry.stopAgentCrons(id),
  ).catch(() => {});
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_AGENT, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Seed an agent at startup (insert-if-absent).
 * DB is the source of truth — if the row already exists, log drift warnings
 * but do not overwrite.
 */
export async function seedAgent(
  data: Partial<LTAgent> & { id: string },
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(SEED_AGENT, [
    data.id,
    data.description ?? null,
    data.status ?? 'inactive',
    data.user_id ?? null,
    data.knowledge_domain ?? null,
    JSON.stringify(data.capabilities ?? []),
    JSON.stringify(data.behaviors ?? {}),
    data.goals ?? null,
    data.rules ?? null,
    data.workflow_type ?? null,
    data.pipeline_id ?? null,
    JSON.stringify(data.metadata ?? {}),
  ]);

  const inserted = (rowCount ?? 0) > 0;

  if (!inserted) {
    const existing = await getAgent(data.id);
    if (existing) {
      const drifts: string[] = [];
      if (data.description && existing.description !== data.description) drifts.push('description');
      if (data.status && existing.status !== data.status) drifts.push('status');
      if (data.knowledge_domain && existing.knowledge_domain !== data.knowledge_domain) drifts.push('knowledge_domain');
      if (drifts.length) {
        loggerRegistry.warn(`[long-tail] agent drift: ${data.id} — ${drifts.join(', ')} differ between code and DB`);
      }
    }
  }

  return inserted;
}

/**
 * Aggregate stats for an agent: knowledge entry count, pending escalation count,
 * and last workflow execution time.
 */
export async function getAgentStats(agent: LTAgent): Promise<LTAgentStats> {
  const pool = getPool();
  const stats: LTAgentStats = {
    knowledge_count: 0,
    escalation_count: 0,
  };

  if (agent.knowledge_domain) {
    const { rows } = await pool.query(KNOWLEDGE_COUNT, [agent.knowledge_domain]);
    stats.knowledge_count = rows[0]?.count ?? 0;
  }

  if (agent.user_id) {
    const { rows } = await pool.query(ESCALATION_COUNT, [agent.user_id]);
    stats.escalation_count = rows[0]?.count ?? 0;
  }

  stats.last_execution_at = agent.last_run_at ?? undefined;

  return stats;
}
