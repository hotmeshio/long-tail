/**
 * Runs the planner's actions: escalation verbs through LineEscalations,
 * dispatches and commands through the Dispatcher, alarm and machine rows,
 * and the offline debounce. A verb that fails for real throws, so the message that
 * caused it is delivered again. What ran comes back as wire actions, for the
 * record of the message that caused it.
 */

import { DECISION, HANDOFF_ERROR, ROW_TYPE } from '../contracts';
import { operatorRole, type LineDef } from '../../../lib/machines/line';
import { REPLY_STATUS, type LineCodec } from '../../../lib/machines/protocol';
import type { MachineBus } from '../../../lib/machines/transport';
import type { WireAction, WireVerb } from '../../../types/machines-view';
import { CONTROLLER, type Action } from './actions';
import type { AddressBook } from './address-book';
import { VERB_OUTCOME, type LineEscalations, type VerbResult } from './escalations';
import { GATEWAY_LOG, type GatewayLog } from './log';
import type { ReplyWaiter } from './reply-waiter';
import { Dispatcher, GatewayStopped } from './dispatcher';
import { failHandoff } from './plan-shared';
import { DISPATCH_STATE, ROW_END, type GatewayState, type HandoffRow } from './state';
import { plannedAction, type WireRecorder } from './wire';

const NOT_FOUND = 404;
const CONFLICT = 409;

export interface ExecutorDeps {
  bus: MachineBus;
  lt: LineEscalations;
  replies: ReplyWaiter;
  state: GatewayState;
  line: LineDef;
  codec: LineCodec;
  replyTimeoutMs: number;
  dispatchAttempts: number;
  offlineDebounceMs: number;
  log: GatewayLog;
  /** Where learned addresses are kept (registration.ts). */
  addresses: AddressBook;
  /** Records each command sent, for the line's wire view. */
  wire?: Pick<WireRecorder, 'command'>;
}

type DispatchAction = Extract<Action, { kind: 'dispatch' }>;
type CommandAction = Extract<Action, { kind: 'command' | 'control' }>;

/** A verb's outcome as the wire records it: done, already done, or refused by Long Tail. */
function outcomeOf(verb: WireVerb, rowId: string, result: VerbResult): WireAction {
  const refused = result.outcome === VERB_OUTCOME.INVALID || result.status === NOT_FOUND || result.status === CONFLICT;
  if (refused) return { verb: 'refuse', rowId, detail: `${verb}: ${result.detail ?? result.outcome}` };
  return { verb, rowId, ...(result.outcome === VERB_OUTCOME.ALREADY ? { detail: result.detail ?? 'already ended' } : {}) };
}

export class Executor {
  private inflight = new Set<Promise<void>>();
  private quietPending = new Set<string>();
  private timers = new Set<NodeJS.Timeout>();
  private stopped = false;

  private readonly dispatcher: Dispatcher;

  constructor(private readonly d: ExecutorDeps) {
    this.dispatcher = new Dispatcher(d);
  }

  /** Dispatches and commands run detached so one slow reply never holds up the feed. */
  async apply(actions: Action[]): Promise<WireAction[]> {
    const done: WireAction[] = [];
    for (const action of actions) {
      if (action.kind === 'dispatch') this.track(this.dispatcher.dispatch(action));
      else if (action.kind === 'command') this.track(this.dispatcher.command(action));
      else if (action.kind === 'control') this.track(this.dispatcher.control(action));
      else {
        done.push(...await this.run(action));
        continue;
      }
      done.push(plannedAction(action));
    }
    return done;
  }

  /** Resolves when every detached dispatch has finished. */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  /** Work still running sends nothing more and raises no row; the next leader takes it up from the message or the row. */
  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.dispatcher.stop();
    this.d.replies.cancelAll();
  }

  /** A row raised after stop() would be raised again by the next leader, so the message is nak'd instead. */
  private live(): void {
    if (this.stopped) throw new GatewayStopped();
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch((err) => {
      if (!(err instanceof GatewayStopped)) this.d.log.error(GATEWAY_LOG.VERB_FAILED, { error: String(err?.message ?? err) });
    })
      .finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  private async run(a: Exclude<Action, DispatchAction | CommandAction>): Promise<WireAction[]> {
    const { lt, state, replies } = this.d;
    switch (a.kind) {
      case 'claim': {
        const result = await lt.claim(a.as, a.rowId);
        this.check(a, result);
        return [outcomeOf('claim', a.rowId, result)];
      }
      case 'accumulate':
        return this.accumulate(a);
      case 'resolve': {
        const result = await lt.resolve(a.as, a.rowId, a.payload);
        this.check(a, result);
        state.close(a.rowId);
        return [outcomeOf('resolve', a.rowId, result)];
      }
      case 'createAlarmRow':
        return [{ verb: 'create-row', rowId: await this.createAlarmRow(a), detail: `${a.row.type} ${a.alarmId} at ${a.machineId}` }];
      case 'createRow': {
        this.live();
        const { id } = await lt.create(CONTROLLER, a.row);
        this.d.log.info(GATEWAY_LOG.VIOLATION_ROW, { row: id, type: a.row.type });
        return [{ verb: 'create-row', rowId: id, detail: a.row.type }];
      }
      case 'watchOffline':
        this.watchOffline(a.machineId);
        return [plannedAction(a)];
      case 'settleReply':
        if (replies.settle({ cmdId: a.cmdId, status: a.status, reason: a.reason, ...(a.code ? { code: a.code } : {}), ...(a.preparing ? { preparing: true } : {}) })) return [plannedAction(a)];
        return [{ verb: 'ack', detail: `late ${a.status} ${a.cmdId}` }, ...await this.lateReply(a)];
      case 'settleSnapshot':
        replies.settleSnapshot(a.machineId, new Set(a.jobIds));
        return [plannedAction(a)];
      case 'bindAddress':
        await this.d.addresses.bind(a.machineId, a.address);
        state.bindAddress(a.machineId, a.address);
        this.d.log.info(GATEWAY_LOG.ADDRESS_BOUND, { machine: a.machineId, address: a.address, ...(a.by ? { approvedBy: a.by } : {}) });
        return [{ verb: 'ack', detail: `bound ${a.machineId} to ${a.address}` }];
      case 'refuseBinding':
        this.d.log.warn(GATEWAY_LOG.ADDRESS_REFUSED, { machine: a.machineId, address: a.address, reason: a.reason });
        return [plannedAction(a)];
      case 'unrecoverable':
        this.d.log.warn(GATEWAY_LOG.DISPATCH_UNRECOVERABLE, { machine: a.machineId, jobs: a.jobs });
        return [plannedAction(a)];
    }
  }

  /**
   * A dispatch's second reply: ready, or a failure to prepare that ends the
   * handoff. When the handoff into the machine has already ended, as one
   * dispatched on arrival does at acceptance, the failure ends the handoff
   * carrying the units out of it.
   */
  private async lateReply(a: Extract<Action, { kind: 'settleReply' }>): Promise<WireAction[]> {
    const { state, log } = this.d;
    const into = state.rowForDispatch(a.cmdId);
    const m = into?.toMachine;
    if (!into || !m) return [];
    const context = { row: into.id, machine: m, cmdId: a.cmdId, reason: a.reason };
    if (a.status === REPLY_STATUS.COMPLETED) {
      log.info(GATEWAY_LOG.DISPATCH_READY, context);
      return this.readyForArrival(into, m, a.cmdId);
    }
    if (a.status !== REPLY_STATUS.FAILED) return [];
    const row = into.ended ? onwardRow(state, into, m) : into;
    log.warn(GATEWAY_LOG.DISPATCH_FAILED, { ...context, ...(into.ended ? { onward: row?.id ?? null } : {}) });
    if (!row) return [];
    return this.apply(failHandoff(state, row, m, {
      received: false, errorCode: HANDOFF_ERROR.DISPATCH_FAILED, detail: `${m} could not prepare the job: ${a.reason}`, ...(a.code ? { code: a.code } : {}),
    }));
  }

  /** On arrival dispatch, a row that waited for the machine to prepare is received once every job it sent is ready. */
  private async readyForArrival(into: HandoffRow, m: string, cmdId: string): Promise<WireAction[]> {
    const { lt, state } = this.d;
    if (into.ended || !into.awaitingReady?.has(cmdId)) return [];
    into.awaitingReady.delete(cmdId);
    if (into.awaitingReady.size) return [];
    const units = into.units.map((u) => u.unitId);
    const resolved = await lt.resolve(m, into.id, { received: true, receiver: m, units });
    state.close(into.id);
    return [outcomeOf('resolve', into.id, resolved)];
  }

  /** Add the item; when the row then holds every key the action waits for, resolve it. */
  private async accumulate(a: Extract<Action, { kind: 'accumulate' }>): Promise<WireAction[]> {
    const { lt, state } = this.d;
    const result = await lt.accumulate(a.as, a.rowId, a.itemKey, a.payload, a.metadata);
    this.check(a, result);
    const added = { ...outcomeOf('accumulate', a.rowId, result), itemKey: a.itemKey };
    if (!a.complete || result.outcome === VERB_OUTCOME.INVALID) return [added];
    const held = new Set(result.itemKeys ?? await lt.itemKeys(a.rowId));
    if (!a.complete.keys.every((k) => held.has(k))) return [added];
    if (a.complete.then) return [added, ...await this.apply(a.complete.then)];
    const resolved = await lt.resolve(a.as, a.rowId, a.complete.payload ?? {});
    this.check(a, resolved);
    state.close(a.rowId);
    return [added, outcomeOf('resolve', a.rowId, resolved)];
  }

  private check(a: Action, result: VerbResult): void {
    const rowId = (a as { rowId?: string }).rowId;
    if (result.outcome === VERB_OUTCOME.INVALID) {
      this.d.log.error(GATEWAY_LOG.VERB_INVALID, { action: a.kind, row: rowId, detail: result.detail });
    }
    // Refused on a row the gateway holds open: outside the actor's roles (404) or claimed by someone else (409).
    const open = rowId ? this.d.state.get(rowId) : undefined;
    if (open && (result.status === NOT_FOUND || result.status === CONFLICT)) {
      const event = result.status === NOT_FOUND ? GATEWAY_LOG.ROW_NOT_VISIBLE : GATEWAY_LOG.ROW_CLAIMED_ELSEWHERE;
      this.d.log.warn(event, { action: a.kind, row: rowId, as: (a as { as?: string }).as, role: open.role, detail: result.detail });
    }
  }

  private async createAlarmRow(a: Extract<Action, { kind: 'createAlarmRow' }>): Promise<string> {
    this.live();
    const { id } = await this.d.lt.create(CONTROLLER, { ...a.row, role: operatorRole(this.d.line) });
    this.d.log.info(GATEWAY_LOG.ALARM_ROW, { row: id, machine: a.machineId, alarm: a.alarmId });
    const track = this.d.state.alarms.get(this.d.state.alarmKey(a.machineId, a.alarmId));
    const raisedAt = a.row.metadata?.raisedAt;
    if (track && (!track.raisedAt || !raisedAt || track.raisedAt === raisedAt)) {
      track.rowId = id;
      return id;
    }
    // Cleared at the machine, or raised again, while the row was being created.
    const note = track ? `${a.machineId} raised ${a.alarmId} again; this one ended` : `cleared at ${a.machineId}`;
    await this.d.lt.resolve(CONTROLLER, id, { decision: DECISION.CLEARED, note });
    return id;
  }

  /** Raise a quiet row for each connected machine silent longer than `quietMs`. */
  checkQuiet(machineIds: string[], quietMs: number): void {
    const now = Date.now();
    for (const machineId of machineIds) {
      const link = this.d.state.link(machineId);
      if (!link.online || link.quietRowId || this.quietPending.has(machineId) || now - link.lastSeen < quietMs) continue;
      this.quietPending.add(machineId);
      this.track(this.raiseQuiet(machineId, now - link.lastSeen).finally(() => this.quietPending.delete(machineId)));
    }
  }

  private async raiseQuiet(machineId: string, silentMs: number): Promise<void> {
    this.live();
    const { id } = await this.d.lt.create(CONTROLLER, {
      type: ROW_TYPE.MACHINE_QUIET, role: operatorRole(this.d.line), priority: 2,
      description: `${machineId} is connected but has sent nothing for ${Math.round(silentMs / 1000)} s`,
      metadata: { siteId: this.d.line.siteId, lineId: this.d.line.lineId, machineId, silentMs },
    });
    this.d.log.info(GATEWAY_LOG.QUIET_ROW, { row: id, machine: machineId });
    this.d.state.link(machineId).quietRowId = id;
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
    this.live();
    const since = new Date(link.since).toISOString();
    const { id } = await this.d.lt.create(CONTROLLER, {
      type: ROW_TYPE.MACHINE_OFFLINE, role: operatorRole(this.d.line), priority: 2,
      description: `${machineId} has been offline since ${since}`,
      metadata: { siteId: this.d.line.siteId, lineId: this.d.line.lineId, machineId, offlineSince: since, ...(link.reason ? { reason: link.reason } : {}) },
    });
    this.d.log.info(GATEWAY_LOG.OFFLINE_ROW, { row: id, machine: machineId });
    if (!link.online) link.rowId = id;
    else await this.d.lt.resolve(CONTROLLER, id, { decision: DECISION.RESTORED, note: `${machineId} back online` });
  }
}

/** The open handoff out of `m` for units a closed handoff brought into it. */
function onwardRow(state: GatewayState, into: HandoffRow, m: string): HandoffRow | undefined {
  if (into.ended !== ROW_END.RESOLVED || into.dispatch !== DISPATCH_STATE.ACCEPTED) return undefined;
  for (const u of into.units) {
    const row = state.openFor(u.unitId, (r) => r.fromMachine === m);
    if (row) return row;
  }
  return undefined;
}
