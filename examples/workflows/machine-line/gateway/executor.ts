/**
 * Runs the planner's actions: escalation verbs through LineEscalations,
 * commands onto the machine bus, the dispatch request/reply cycle, and the
 * offline debounce. A verb that fails for real throws, so the message that
 * caused it is delivered again.
 */

import { DECISION, HANDOFF_ERROR, LINE_ROLE, ROW_TYPE } from '../contracts';
import { identOf, type LineDef } from '../line';
import { CHANNEL, OP, REPLY_STATUS, buildEnvelope, machineTopic } from '../protocol';
import type { MachineBus } from '../transport';
import { CONTROLLER, type Action } from './actions';
import { VERB_OUTCOME, type LineEscalations, type VerbResult } from './escalations';
import { GATEWAY_LOG, type GatewayLog } from './log';
import type { ReplyWaiter } from './reply-waiter';
import { DISPATCH_STATE, type GatewayState } from './state';

export interface ExecutorDeps {
  bus: MachineBus;
  lt: LineEscalations;
  replies: ReplyWaiter;
  state: GatewayState;
  line: LineDef;
  topicRoot: string;
  replyTimeoutMs: number;
  dispatchAttempts: number;
  offlineDebounceMs: number;
  log: GatewayLog;
}

type DispatchAction = Extract<Action, { kind: 'dispatch' }>;

export class Executor {
  private inflight = new Set<Promise<void>>();
  private timers = new Set<NodeJS.Timeout>();

  constructor(private readonly d: ExecutorDeps) {}

  /** Dispatches run detached so one slow reply never holds up the feed. */
  async apply(actions: Action[]): Promise<void> {
    for (const action of actions) {
      if (action.kind === 'dispatch') this.track(this.dispatch(action));
      else await this.run(action);
    }
  }

  /** Resolves when every detached dispatch has finished. */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.d.replies.cancelAll();
  }

  async publishCommand(machineId: string, op: string, cmdId: string, args: Record<string, any>): Promise<void> {
    const ident = identOf(this.d.line, machineId);
    const env = buildEnvelope(ident, { cmdId, op, args });
    await this.d.bus.publish(machineTopic(this.d.topicRoot, ident, CHANNEL.CMD), JSON.stringify(env));
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch((err) => this.d.log.error(GATEWAY_LOG.VERB_FAILED, { error: String(err?.message ?? err) }))
      .finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  private async run(a: Exclude<Action, DispatchAction>): Promise<void> {
    const { lt, state, replies } = this.d;
    switch (a.kind) {
      case 'command':
        return this.publishCommand(a.machineId, a.op, a.cmdId, a.args);
      case 'claim':
        return this.check(a, await lt.claim(a.as, a.rowId));
      case 'accumulate':
        return this.check(a, await lt.accumulate(a.as, a.rowId, a.itemKey, a.payload));
      case 'resolve':
        this.check(a, await lt.resolve(a.as, a.rowId, a.payload));
        state.close(a.rowId);
        return;
      case 'createAlarmRow':
        return this.createAlarmRow(a);
      case 'watchOffline':
        return this.watchOffline(a.machineId);
      case 'settleReply':
        replies.settle({ cmdId: a.cmdId, status: a.status, reason: a.reason });
    }
  }

  private check(a: Action, result: VerbResult): void {
    if (result.outcome === VERB_OUTCOME.INVALID) {
      this.d.log.error(GATEWAY_LOG.VERB_INVALID, { action: a.kind, row: (a as any).rowId, detail: result.detail });
    }
  }

  private async dispatch(a: DispatchAction): Promise<void> {
    const { replies, lt, state, log } = this.d;
    let reply = null;
    for (let attempt = 1; attempt <= this.d.dispatchAttempts && !reply; attempt++) {
      const waiting = replies.wait(a.cmdId, this.d.replyTimeoutMs);
      await this.publishCommand(a.machineId, OP.DISPATCH, a.cmdId, a.args);
      reply = await waiting;
    }
    const row = state.get(a.rowId);
    if (reply?.status === REPLY_STATUS.ACCEPTED) {
      if (row) row.dispatch = DISPATCH_STATE.ACCEPTED;
      log.info(GATEWAY_LOG.DISPATCHED, { row: a.rowId, machine: a.machineId, reason: reply.reason });
      this.check(a, await lt.claim(a.machineId, a.rowId));
      return;
    }
    if (row) row.dispatch = DISPATCH_STATE.REFUSED;
    const resolution = reply
      ? { received: false, errorCode: HANDOFF_ERROR.DISPATCH_REFUSED, detail: `${a.machineId} ${reply.status}: ${reply.reason}` }
      : { received: false, errorCode: HANDOFF_ERROR.NO_REPLY, detail: `${a.machineId} sent no reply after ${this.d.dispatchAttempts} attempts` };
    log.warn(GATEWAY_LOG.DISPATCH_REFUSED, { row: a.rowId, machine: a.machineId, ...resolution });
    this.check(a, await lt.resolve(reply ? a.machineId : CONTROLLER, a.rowId, resolution));
    state.close(a.rowId);
  }

  private async createAlarmRow(a: Extract<Action, { kind: 'createAlarmRow' }>): Promise<void> {
    const { id } = await this.d.lt.create(CONTROLLER, a.row);
    this.d.log.info(GATEWAY_LOG.ALARM_ROW, { row: id, machine: a.machineId, alarm: a.alarmId });
    const track = this.d.state.alarms.get(this.d.state.alarmKey(a.machineId, a.alarmId));
    if (track) {
      track.rowId = id;
      return;
    }
    // Cleared at the machine while the row was being created.
    await this.d.lt.resolve(CONTROLLER, id, { decision: DECISION.CLEARED, note: `cleared at ${a.machineId}` });
  }

  private watchOffline(machineId: string): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.track(this.raiseOffline(machineId));
    }, this.d.offlineDebounceMs);
    this.timers.add(timer);
  }

  private async raiseOffline(machineId: string): Promise<void> {
    const link = this.d.state.links.get(machineId);
    if (!link) return;
    link.watching = false;
    if (link.online || link.rowId) return;
    const since = new Date(link.since).toISOString();
    const { id } = await this.d.lt.create(CONTROLLER, {
      type: ROW_TYPE.MACHINE_OFFLINE, role: LINE_ROLE.OPERATOR, priority: 2,
      description: `${machineId} has been offline since ${since}`,
      metadata: { machineId, offlineSince: since },
    });
    this.d.log.info(GATEWAY_LOG.OFFLINE_ROW, { row: id, machine: machineId });
    if (!link.online) link.rowId = id;
    else await this.d.lt.resolve(CONTROLLER, id, { decision: DECISION.RESTORED, note: `${machineId} back online` });
  }
}
