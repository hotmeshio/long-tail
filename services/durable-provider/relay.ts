import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import {
  DELIVERY_RESULT,
  JOB_STATE,
  WAIT_OUTCOME_STATUS,
  type LTDurableProvider,
  type LTDurableRelayConfig,
  type LTWaitOutcome,
  type LTWaitOutcomeStatus,
} from '../../types/durable-provider';
import { cancelEscalationsByWorkflowId, publishEscalationChange } from '../escalation/crud';
import { toEscalationRecord } from '../escalation/map';
import { escalationEventData } from '../../lib/events/escalation-wire';
import { DURABLE_LOG, RELAY_DEFAULTS } from './constants';
import { WorkflowFollower } from './follow';
import {
  CLAIM_DELIVERIES,
  expireDueSql,
  MARK_DELIVERED,
  MARK_RETRY,
  PENDING_WORKFLOWS,
  PRUNE_ORPHANED_WAITS,
} from './sql';

export interface RelayPassResult {
  expired: number;
  delivered: number;
  gone: number;
  retried: number;
}

interface ClaimedDelivery {
  escalation_id: string;
  provider: string;
  workflow_id: string;
  workflow_type: string | null;
  run_scope: string;
  wait_key: string;
  attempts: number;
  status: LTWaitOutcomeStatus;
  resolver_payload: Record<string, unknown> | null;
  resolved_at: Date | null;
  updated_at: Date | null;
  resolved_by: string | null;
}

const RECONCILE_PAGE = 200;
const OPEN_JOB_STATES: string[] = [JOB_STATE.RUNNING];

/**
 * Delivers each terminal escalation outcome to its waiting workflow once.
 * Runs on escalation events, with a slow sweep as the recovery net. The
 * sweep also expires overdue waits; reconcile closes escalations whose
 * workflow ended without them. After a delivery, the follower publishes the
 * workflow's completion once the engine reports it.
 */
export class DurableRelay {
  private readonly sweepMs: number;
  private readonly leaseMs: number;
  private readonly batch: number;
  private readonly reconcileMs: number;
  private timers: NodeJS.Timeout[] = [];
  private kickTimer: NodeJS.Timeout | null = null;
  private running: Promise<RelayPassResult> | null = null;
  private rerun = false;
  private readonly follower: WorkflowFollower;

  constructor(private readonly provider: LTDurableProvider, config: LTDurableRelayConfig = {}) {
    this.sweepMs = config.sweepMs ?? RELAY_DEFAULTS.SWEEP_MS;
    this.leaseMs = config.leaseMs ?? RELAY_DEFAULTS.LEASE_MS;
    this.batch = config.batch ?? RELAY_DEFAULTS.BATCH;
    this.reconcileMs = config.reconcileMs ?? RELAY_DEFAULTS.RECONCILE_MS;
    this.follower = new WorkflowFollower(provider);
    if (this.sweepMs <= 0 || this.leaseMs <= 0 || this.batch <= 0 || this.reconcileMs < 0) {
      throw new Error('durable.relay: sweepMs, leaseMs and batch must be positive; reconcileMs zero or positive');
    }
  }

  start(): void {
    this.kick();
    this.timers.push(setInterval(() => this.kick(), this.sweepMs).unref());
    if (this.reconcileMs > 0) {
      this.timers.push(setInterval(() => { void this.reconcile(); }, this.reconcileMs).unref());
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = null;
    this.follower.stop();
    await this.running?.catch(() => undefined);
  }

  /** Publish the workflow's completion when the engine reports it closed. */
  follow(workflowId: string, workflowType: string): void {
    this.follower.follow(workflowId, workflowType);
  }

  /** Schedule a pass soon; bursts of events collapse into one pass. */
  kick(): void {
    if (this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.run().catch((err) => {
        loggerRegistry.error(DURABLE_LOG.RELAY_FAILED, { error: err instanceof Error ? err.message : String(err) });
      });
    }, RELAY_DEFAULTS.KICK_DEBOUNCE_MS);
    this.kickTimer.unref?.();
  }

  /** One pass: expire overdue waits, then deliver every claimable outcome. */
  async run(): Promise<RelayPassResult> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.pass();
    try {
      return await this.running;
    } finally {
      this.running = null;
      if (this.rerun) {
        this.rerun = false;
        this.kick();
      }
    }
  }

  /** Cancel pending escalations whose workflow is no longer running. Returns the count cancelled. */
  async reconcile(): Promise<number> {
    let cursor = '';
    let cancelled = 0;
    for (;;) {
      const { rows } = await getPool().query(PENDING_WORKFLOWS, [this.provider.name, cursor, RECONCILE_PAGE]);
      for (const { workflow_id: workflowId } of rows) {
        cursor = workflowId;
        try {
          const status = await this.provider.describe(workflowId);
          if (OPEN_JOB_STATES.includes(status.state)) continue;
          cancelled += await cancelEscalationsByWorkflowId(workflowId);
        } catch (err) {
          loggerRegistry.warn(DURABLE_LOG.RELAY_FAILED, { workflowId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (rows.length < RECONCILE_PAGE) break;
    }
    await getPool().query(PRUNE_ORPHANED_WAITS);
    if (cancelled) {
      loggerRegistry.info(DURABLE_LOG.WAITS_RECONCILED, { provider: this.provider.name, cancelled });
      this.kick();
    }
    return cancelled;
  }

  private async pass(): Promise<RelayPassResult> {
    const result: RelayPassResult = { expired: await this.expireDue(), delivered: 0, gone: 0, retried: 0 };
    for (;;) {
      const { rows } = await getPool().query<ClaimedDelivery>(CLAIM_DELIVERIES, [this.leaseMs, this.batch]);
      for (const row of rows) {
        const outcome = await this.deliverOne(row);
        result[outcome]++;
      }
      if (rows.length < this.batch) break;
    }
    return result;
  }

  private async expireDue(): Promise<number> {
    const { rows } = await getPool().query(expireDueSql());
    for (const entry of rows) {
      const escalation = toEscalationRecord(entry);
      void publishEscalationChange({
        type: 'escalation.expired',
        source: 'service',
        workflowId: escalation.workflow_id || '',
        workflowName: escalation.workflow_type || '',
        taskQueue: escalation.task_queue || '',
        escalationId: escalation.id,
        role: escalation.role,
        status: WAIT_OUTCOME_STATUS.EXPIRED,
        data: escalationEventData(escalation),
      });
    }
    if (rows.length) loggerRegistry.info(DURABLE_LOG.WAITS_EXPIRED, { provider: this.provider.name, count: rows.length });
    return rows.length;
  }

  private async deliverOne(row: ClaimedDelivery): Promise<'delivered' | 'gone' | 'retried'> {
    const ref = { provider: row.provider, workflowId: row.workflow_id, runScope: row.run_scope, waitKey: row.wait_key };
    try {
      const result = await this.provider.deliver(ref, toOutcome(row));
      await getPool().query(MARK_DELIVERED, [row.escalation_id, result]);
      const event = result === DELIVERY_RESULT.GONE ? DURABLE_LOG.RELAY_GONE : DURABLE_LOG.RELAY_DELIVERED;
      loggerRegistry.info(event, { ...ref, escalationId: row.escalation_id, status: row.status });
      if (result === DELIVERY_RESULT.GONE) return 'gone';
      this.follower.follow(row.workflow_id, row.workflow_type ?? '');
      return 'delivered';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await getPool().query(MARK_RETRY, [row.escalation_id, message, backoffMs(row.attempts)]);
      loggerRegistry.warn(DURABLE_LOG.RELAY_RETRY, { ...ref, escalationId: row.escalation_id, attempts: row.attempts, error: message });
      return 'retried';
    }
  }
}

/** Resolved rows carry the resolver payload; expired rows carry a collection when the timeout stored one. */
function toOutcome(row: ClaimedDelivery): LTWaitOutcome {
  const carriesData = row.status === WAIT_OUTCOME_STATUS.RESOLVED || row.status === WAIT_OUTCOME_STATUS.EXPIRED;
  const at = row.resolved_at ?? row.updated_at;
  return {
    waitKey: row.wait_key,
    escalationId: row.escalation_id,
    status: row.status,
    ...(carriesData && row.resolver_payload ? { data: row.resolver_payload } : {}),
    ...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
    ...(at ? { resolvedAt: new Date(at).toISOString() } : {}),
  };
}

/** Capped exponential backoff for a failed delivery. */
export function backoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(RELAY_DEFAULTS.BACKOFF_BASE_MS * 2 ** exponent, RELAY_DEFAULTS.BACKOFF_MAX_MS);
}
