/**
 * Commands to machines and their replies. A dispatch becomes one command per
 * job (gateway/jobs.ts); missing replies are asked for again with the same
 * command ids, and the row is claimed once every job is accepted. Silence is
 * not a refusal: the gateway asks the machine what it holds, and a job it
 * holds counts as accepted. When a dispatch ends without that, the row is
 * resolved with the error and every job is cancelled, so a dispatch still
 * queued for a machine that was away never runs later. A machine-command row is resolved with its command's
 * reply. Other commands are tracked for their reply and logged. A command the
 * codec has no message for is unsupported: nothing is sent or awaited.
 */

import { setTimeout as sleep } from 'timers/promises';

import { COMMAND_STATUS, HANDOFF_ERROR, cancelCommandId, controlCommandId, type CommandResolution, type HandoffResolution } from '../contracts';
import type { LineDef } from '../../../lib/machines/line';
import { identFor } from './registration';
import { OP, REPLY_STATUS, isoTs, type LineCodec } from '../../../lib/machines/protocol';
import type { MachineBus } from '../../../lib/machines/transport';
import { CONTROLLER, type Action } from './actions';
import { VERB_OUTCOME, type LineEscalations, type VerbResult } from './escalations';
import { dispatchJobs, type DispatchJob } from './jobs';
import { dispatchWindow } from './pacing';
import { GATEWAY_LOG, type GatewayLog } from './log';
import type { CommandReply, HeldJobs, ReplyWaiter } from './reply-waiter';
import { DISPATCH_STATE, type GatewayState } from './state';
import type { WireRecorder } from './wire';

export interface DispatcherDeps {
  bus: MachineBus;
  codec: LineCodec;
  line: LineDef;
  lt: LineEscalations;
  replies: ReplyWaiter;
  state: GatewayState;
  replyTimeoutMs: number;
  dispatchAttempts: number;
  log: GatewayLog;
  /** Records each command the gateway sends, for the line's wire view. */
  wire?: Pick<WireRecorder, 'command'>;
}

type DispatchAction = Extract<Action, { kind: 'dispatch' }>;
type CommandAction = Extract<Action, { kind: 'command' }>;
type ControlAction = Extract<Action, { kind: 'control' }>;

/** A reply the machine sent, as opposed to none or an unsupported command. */
function fromMachine(reply: CommandReply | null): reply is CommandReply {
  return !!reply && reply.status !== COMMAND_STATUS.UNSUPPORTED;
}

/** The machine took the work: recorded it, or already has it ready. */
function took(reply: CommandReply | null): boolean {
  return reply?.status === REPLY_STATUS.ACCEPTED || reply?.status === REPLY_STATUS.COMPLETED;
}

/** The reply's structured code for a resolution, when it carried one. */
function withCode(reply: CommandReply): { code?: string } {
  return reply.code ? { code: reply.code } : {};
}

/** Most command ids whose sends are counted; the oldest are forgotten first. */
const SENT_REMEMBERED = 10_000;

/** Ends a dispatch or command still running when the gateway stops; the next leader takes it up from the row. */
export class GatewayStopped extends Error {
  constructor() {
    super('the gateway stopped');
  }
}

export class Dispatcher {
  private readonly sent = new Map<string, { attempt: number; issuedAt: number }>();
  private readonly stopping = new AbortController();

  constructor(private readonly d: DispatcherDeps) {}

  /** Work still running sends nothing more and changes no row. */
  stop(): void {
    this.stopping.abort();
  }

  private live(): void {
    if (this.stopping.signal.aborted) throw new GatewayStopped();
  }

  /**
   * This send's attempt number, whether the machine may have the command already, and when it was
   * issued: the time given (a round's start, the same for every gateway), else the first send's.
   */
  private countSend(cmdId: string, since?: number, issuedAt?: number): { attempt: number; retry: boolean; issuedAt: string } {
    const before = this.sent.get(cmdId);
    const record = { attempt: (before?.attempt ?? 0) + 1, issuedAt: issuedAt ?? before?.issuedAt ?? Date.now() };
    this.sent.delete(cmdId);
    this.sent.set(cmdId, record);
    if (this.sent.size > SENT_REMEMBERED) this.sent.delete(this.sent.keys().next().value!);
    const retry = record.attempt > 1 || (since !== undefined && since < this.d.state.takenAt);
    return { attempt: record.attempt, retry, issuedAt: isoTs(record.issuedAt) };
  }

  /** False when the codec has no message for the command. `since` is when the command's row was created. */
  async publish(machineId: string, op: string, cmdId: string, args: Record<string, any>, since?: number, issuedAt?: number): Promise<boolean> {
    this.live();
    const ident = identFor(this.d.state, this.d.line, machineId);
    const command = { cmdId, op, args, ...this.countSend(cmdId, since, issuedAt) };
    const wires = this.d.codec.encode(ident, command);
    for (const wire of wires) {
      await this.d.bus.publish(wire.topic, wire.payload);
      this.d.wire?.command(ident, command, wire);
    }
    return wires.length > 0;
  }

  /** Publish and wait for the reply, asking again with the same id; null when none came. */
  async ask(machineId: string, op: string, cmdId: string, args: Record<string, any>, since?: number, issuedAt?: number): Promise<CommandReply | null> {
    for (let attempt = 1; attempt <= this.d.dispatchAttempts; attempt++) {
      this.live();
      const waiting = this.d.replies.wait(cmdId, this.d.replyTimeoutMs);
      if (!await this.publish(machineId, op, cmdId, args, since, issuedAt)) {
        this.d.replies.settle({ cmdId, status: COMMAND_STATUS.UNSUPPORTED, reason: `the line's codec has no ${op} command` });
      }
      const reply = await waiting;
      this.live();
      if (reply) return reply;
    }
    return null;
  }

  async command(a: CommandAction): Promise<void> {
    const reply = await this.ask(a.machineId, a.op, a.cmdId, a.args);
    if (!reply) this.d.log.warn(GATEWAY_LOG.COMMAND_UNANSWERED, { machine: a.machineId, op: a.op, cmdId: a.cmdId });
    else if (reply.status === COMMAND_STATUS.UNSUPPORTED) this.d.log.info(GATEWAY_LOG.COMMAND_UNSUPPORTED, { machine: a.machineId, op: a.op });
    else if (reply.status !== REPLY_STATUS.ACCEPTED) {
      this.d.log.warn(GATEWAY_LOG.COMMAND_REFUSED, { machine: a.machineId, op: a.op, cmdId: a.cmdId, status: reply.status, reason: reply.reason });
    }
  }

  /**
   * A machine-command row: send it, then resolve the row with the reply, as the
   * machine that gave it. The command expires when the asking ends, so one that
   * reaches a machine after its row resolved no-reply is refused, never run.
   * Rounds of the asking count from the row's creation, so the command sent
   * again by a new gateway is the same command with the same arguments.
   */
  async control(a: ControlAction): Promise<void> {
    const now = Date.now();
    const ttlMs = this.d.replyTimeoutMs * this.d.dispatchAttempts;
    const { round, expiresAt } = dispatchWindow(a.createdAt ?? now, now, ttlMs);
    const reply = await this.ask(a.machineId, a.op, controlCommandId(a.rowId, round), { ...a.args, expiresAt: isoTs(expiresAt) }, a.createdAt, expiresAt - ttlMs);
    // Timers may fire a little early; the command must have expired before the row says no-reply.
    if (!reply && Date.now() <= expiresAt) await sleep(expiresAt - Date.now() + 1, undefined, { signal: this.stopping.signal }).catch(() => undefined);
    this.live();
    const outcome: CommandResolution = reply
      ? { accepted: reply.status === REPLY_STATUS.ACCEPTED, machineId: a.machineId, op: a.op, status: reply.status as CommandResolution['status'], reason: reply.reason, ...withCode(reply) }
      : { accepted: false, machineId: a.machineId, op: a.op, status: COMMAND_STATUS.NO_REPLY, reason: `no reply after ${this.d.dispatchAttempts} attempts` };
    const context = { row: a.rowId, machine: a.machineId, op: a.op, status: outcome.status, reason: outcome.reason };
    if (outcome.accepted) this.d.log.info(GATEWAY_LOG.COMMANDED, context);
    else this.d.log.warn(!reply ? GATEWAY_LOG.COMMAND_UNANSWERED : fromMachine(reply) ? GATEWAY_LOG.COMMAND_REFUSED : GATEWAY_LOG.COMMAND_UNSUPPORTED, context);
    this.check(a.rowId, 'resolve', await this.d.lt.resolve(fromMachine(reply) ? a.machineId : CONTROLLER, a.rowId, outcome as unknown as Record<string, any>));
  }

  async dispatch(a: DispatchAction): Promise<void> {
    const { lt, state, log } = this.d;
    if (a.receivedOnAccept) {
      // An arrival may be delivered again after the job went out; send it once.
      const row = state.get(a.rowId);
      if (row?.dispatch !== DISPATCH_STATE.ARRIVING) return;
      row.dispatch = DISPATCH_STATE.PENDING;
    }
    const jobs = dispatchJobs(a.args.jobId, a.args.units, state.unitsPerDispatch);
    // Known before any reply, so a failure that follows an acceptance finds its row.
    for (const job of jobs) state.rememberDispatch(`${a.cmdId}${job.suffix}`, a.rowId);
    const since = state.get(a.rowId)?.createdAt;
    const replies = await Promise.all(jobs.map((job) => this.ask(a.machineId, OP.DISPATCH, `${a.cmdId}${job.suffix}`, { ...a.args, jobId: job.jobId, units: job.units }, since, a.issuedAt)));
    const refused = replies.find((r) => r && !took(r));
    const silent = jobs.filter((_, i) => !replies[i]);
    const held = !refused && silent.length ? await this.heldJobs(a.machineId, a.cmdId) : null;
    this.live();
    const reconciled = !!held && silent.every((j) => held.has(j.jobId));
    if (a.ended) {
      this.resent(a, jobs, refused ?? null, !refused && (!silent.length || reconciled));
      return;
    }
    const row = state.get(a.rowId);
    if (!refused && (!silent.length || reconciled)) {
      if (row) row.dispatch = DISPATCH_STATE.ACCEPTED;
      for (const job of jobs) state.rememberSent(a.machineId, job.jobId, a.rowId);
      if (reconciled) log.info(GATEWAY_LOG.DISPATCH_RECONCILED, { row: a.rowId, machine: a.machineId, jobs: silent.map((j) => j.jobId) });
      log.info(GATEWAY_LOG.DISPATCHED, { row: a.rowId, machine: a.machineId, reason: replies.map((r) => r?.reason ?? 'held').join('; ') });
      this.check(a.rowId, 'claim', await lt.claim(a.machineId, a.rowId));
      if (!a.receivedOnAccept) return;
      const preparing = jobs.filter((job, i) => replies[i]?.status === REPLY_STATUS.ACCEPTED && replies[i]?.preparing).map((job) => `${a.cmdId}${job.suffix}`);
      if (!preparing.length) {
        await this.received(a);
        return;
      }
      if (row) row.awaitingReady = new Set(preparing);
      log.info(GATEWAY_LOG.DISPATCH_PREPARING, { row: a.rowId, machine: a.machineId, jobs: preparing });
      return;
    }
    // The handoff may have ended meanwhile: a machine that ran the job anyway reports the arrival.
    if (!row) return;
    row.dispatch = DISPATCH_STATE.REFUSED;
    const unanswered = `${a.machineId} sent no reply after ${this.d.dispatchAttempts} attempts`;
    const resolution: HandoffResolution = refused
      ? { received: false, errorCode: HANDOFF_ERROR.DISPATCH_REFUSED, detail: `${a.machineId} ${refused.status}: ${refused.reason}`, ...withCode(refused) }
      : { received: false, errorCode: HANDOFF_ERROR.NO_REPLY, detail: held ? `${unanswered} and does not hold the job` : `${unanswered}; its state is unknown` };
    log.warn(GATEWAY_LOG.DISPATCH_REFUSED, { row: a.rowId, machine: a.machineId, ...resolution });
    const ended = await lt.resolve(fromMachine(refused ?? null) ? a.machineId : CONTROLLER, a.rowId, resolution);
    this.check(a.rowId, 'resolve', ended);
    state.close(a.rowId);
    if (ended.outcome !== VERB_OUTCOME.DONE) return;
    await this.withdraw(a, jobs.filter((_, i) => !replies[i] || took(replies[i])));
  }

  /** A job sent again after the machine restarted, for a row that already ended: the reply is only logged. */
  private resent(a: DispatchAction, jobs: DispatchJob[], refused: CommandReply | null, taken: boolean): void {
    const context = { row: a.rowId, machine: a.machineId, jobs: jobs.map((j) => j.jobId), resent: true };
    if (taken) this.d.log.info(GATEWAY_LOG.DISPATCHED, { ...context, reason: 'sent again after a restart' });
    else this.d.log.warn(GATEWAY_LOG.DISPATCH_REFUSED, { ...context, reason: refused ? `${refused.status}: ${refused.reason}` : 'no reply' });
  }

  /** The units were already at the machine: a job it has taken and is ready for completes the handoff. */
  private async received(a: DispatchAction): Promise<void> {
    this.live();
    const units = (a.args.units as { unitId: string }[]).map((u) => u.unitId);
    this.check(a.rowId, 'resolve', await this.d.lt.resolve(a.machineId, a.rowId, { received: true, receiver: a.machineId, units }));
    this.d.state.close(a.rowId);
  }

  /** Ask a silent machine what it holds; null when it cannot say or does not answer in time. */
  private async heldJobs(machineId: string, cmdId: string): Promise<HeldJobs | null> {
    this.live();
    const waiting = this.d.replies.waitSnapshot(machineId, this.d.replyTimeoutMs);
    if (!await this.publish(machineId, OP.SNAPSHOT, `${cmdId}:status`, {})) this.d.replies.settleSnapshot(machineId, null);
    return waiting;
  }

  private check(rowId: string, verb: string, result: VerbResult): void {
    if (result.outcome === VERB_OUTCOME.INVALID) this.d.log.error(GATEWAY_LOG.VERB_INVALID, { action: verb, row: rowId, detail: result.detail });
  }

  /** Cancel jobs the machine accepted or may still receive; replies are only logged. */
  private async withdraw(a: DispatchAction, jobs: DispatchJob[]): Promise<void> {
    await Promise.all(jobs.map((job) => this.command({
      kind: 'command', machineId: a.machineId, op: OP.CANCEL, cmdId: `${cancelCommandId(a.rowId)}${job.suffix}`, args: { jobId: job.jobId },
    })));
  }
}
