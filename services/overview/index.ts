/**
 * System overview — one call, complete picture.
 *
 * Composes triage, throughput, trends, infrastructure, and process
 * metrics from lt_* tables. All queries run in parallel. No HotMesh
 * schema dependencies — safe regardless of engine initialization state.
 */

import { getPool } from '../../lib/db';
import {
  OVERVIEW_ESCALATION_TRIAGE,
  OVERVIEW_ESCALATION_BY_ROLE,
  OVERVIEW_TASK_THROUGHPUT,
  OVERVIEW_ESCALATION_TRENDS,
  OVERVIEW_TASK_TRENDS,
  OVERVIEW_RESOLUTION_TRENDS,
  OVERVIEW_MCP_INFRASTRUCTURE,
  OVERVIEW_COMPILED_WORKFLOWS,
  OVERVIEW_AGENT_HEALTH,
  OVERVIEW_WORKFLOW_CONFIGS,
  OVERVIEW_PROCESS_SUMMARY,
} from './sql';

const VALID_PERIODS: Record<string, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
};

export interface SystemOverview {
  period: string;
  triage: {
    pending: number;
    claimed: number;
    unclaimed: number;
    aging_30m: number;
    aging_1h: number;
    aging_24h: number;
    oldest_unclaimed_minutes: number;
    created_period: number;
    resolved_period: number;
    resolution_rate_pct: number;
    by_role: Array<{ role: string; pending: number; claimed: number }>;
  };
  throughput: {
    tasks_pending: number;
    tasks_in_progress: number;
    tasks_failed: number;
    tasks_created_1h: number;
    tasks_completed_1h: number;
    tasks_created_period: number;
    tasks_completed_period: number;
    tasks_failed_1h: number;
  };
  trends: {
    escalation_creation: Array<{ hour: string; created: number }>;
    task_completion: Array<{ hour: string; completed: number }>;
    resolution_velocity: Array<{ hour: string; created: number; resolved: number }>;
  };
  infrastructure: {
    mcp_servers: { total: number; connected: number; total_tools: number };
    compiled_workflows: { total: number; active: number };
    agents: { total: number; active: number; paused: number; error: number; stale: number };
    workflow_configs: number;
  };
  processes: {
    total: number;
    active: number;
    completed: number;
    escalated: number;
  };
}

export async function getSystemOverview(period = '24h'): Promise<SystemOverview> {
  const interval = VALID_PERIODS[period] ?? VALID_PERIODS['24h'];
  const pool = getPool();

  // Every query is individually guarded — a single table failure
  // (e.g., during migration) must not crash the entire overview.
  const empty = { rows: [] };
  const [
    escTriage, escByRole, taskThroughput,
    escTrends, taskTrends, resTrends,
    mcpInfra, compiledWf, agentHealth, wfConfigs, processSummary,
  ] = await Promise.all([
    pool.query(OVERVIEW_ESCALATION_TRIAGE, [interval]).catch(() => empty),
    pool.query(OVERVIEW_ESCALATION_BY_ROLE).catch(() => empty),
    pool.query(OVERVIEW_TASK_THROUGHPUT, [interval]).catch(() => empty),
    pool.query(OVERVIEW_ESCALATION_TRENDS, [interval]).catch(() => empty),
    pool.query(OVERVIEW_TASK_TRENDS, [interval]).catch(() => empty),
    pool.query(OVERVIEW_RESOLUTION_TRENDS, [interval]).catch(() => empty),
    pool.query(OVERVIEW_MCP_INFRASTRUCTURE).catch(() => empty),
    pool.query(OVERVIEW_COMPILED_WORKFLOWS).catch(() => empty),
    pool.query(OVERVIEW_AGENT_HEALTH).catch(() => empty),
    pool.query(OVERVIEW_WORKFLOW_CONFIGS).catch(() => empty),
    pool.query(OVERVIEW_PROCESS_SUMMARY, [interval]).catch(() => empty),
  ]);

  const ZEROS = { pending: 0, claimed: 0, unclaimed: 0, aging_30m: 0, aging_1h: 0, aging_24h: 0, oldest_unclaimed_minutes: 0, created_period: 0, resolved_period: 0, in_progress: 0, failed: 0, created_1h: 0, completed_1h: 0, created_period_t: 0, completed_period: 0, failed_1h: 0, total: 0, connected: 0, total_tools: 0, active: 0, paused: 0, error: 0, stale: 0, completed: 0, escalated: 0 };
  const esc = escTriage.rows[0] ?? ZEROS;
  const task = taskThroughput.rows[0] ?? ZEROS;
  const mcp = mcpInfra.rows[0] ?? ZEROS;
  const compiled = compiledWf.rows[0] ?? ZEROS;
  const agents = agentHealth.rows[0] ?? ZEROS;
  const configs = wfConfigs.rows[0] ?? ZEROS;
  const procs = processSummary.rows[0] ?? ZEROS;

  const createdPeriod = esc.created_period || 0;
  const resolvedPeriod = esc.resolved_period || 0;
  const resolutionRate = createdPeriod > 0
    ? Math.round((resolvedPeriod / createdPeriod) * 100)
    : 0;

  return {
    period,
    triage: {
      pending: esc.pending,
      claimed: esc.claimed,
      unclaimed: esc.unclaimed,
      aging_30m: esc.aging_30m,
      aging_1h: esc.aging_1h,
      aging_24h: esc.aging_24h,
      oldest_unclaimed_minutes: esc.oldest_unclaimed_minutes,
      created_period: createdPeriod,
      resolved_period: resolvedPeriod,
      resolution_rate_pct: resolutionRate,
      by_role: escByRole.rows,
    },
    throughput: {
      tasks_pending: task.pending,
      tasks_in_progress: task.in_progress,
      tasks_failed: task.failed,
      tasks_created_1h: task.created_1h,
      tasks_completed_1h: task.completed_1h,
      tasks_created_period: task.created_period,
      tasks_completed_period: task.completed_period,
      tasks_failed_1h: task.failed_1h,
    },
    trends: {
      escalation_creation: escTrends.rows.map((r: any) => ({
        hour: r.hour, created: r.created,
      })),
      task_completion: taskTrends.rows.map((r: any) => ({
        hour: r.hour, completed: r.completed,
      })),
      // Filter out zero-activity hours to keep MCP responses compact
      resolution_velocity: resTrends.rows
        .filter((r: any) => r.created > 0 || r.resolved > 0)
        .map((r: any) => ({
          hour: r.hour, created: r.created, resolved: r.resolved,
        })),
    },
    infrastructure: {
      mcp_servers: { total: mcp.total, connected: mcp.connected, total_tools: mcp.total_tools },
      compiled_workflows: { total: compiled.total, active: compiled.active },
      agents: {
        total: agents.total, active: agents.active,
        paused: agents.paused, error: agents.error, stale: agents.stale,
      },
      workflow_configs: configs.total,
    },
    processes: {
      total: procs.total,
      active: procs.active,
      completed: procs.completed,
      escalated: procs.escalated,
    },
  };
}
