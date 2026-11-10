/**
 * Machine requests and notices at run time (plan-request.ts plans them): park
 * the row once per message and start its workflow, raise an overdue row once
 * its window passes, and send the answer a request row holds, then resolve it.
 */

import { COMMAND_STATUS, ROW_TYPE, answerCommandId, overdueSignalKey, rowWorkflowId, type RequestResolution, type RowWorkflowInput } from '../contracts';
import { readAnswer } from '../requests';
import { machineById, machineRole, operatorRole, type LineDef } from '../../../lib/machines/line';
import type { WireAction } from '../../../types/machines-view';
import { CONTROLLER, type Action } from './actions';
import type { Dispatcher } from './dispatcher';
import { VERB_OUTCOME, type LineEscalations, type VerbResult } from './escalations';
import { GATEWAY_LOG, type GatewayLog } from './log';
import { endRequest, overdueDecision, trackRequest } from './plan-request';
import { rowOpsOf } from './plan-shared';
import type { GatewayState } from './state';
import { WorkflowStartRefused, type LineWorkflows } from './workflows';

const PENDING = 'pending';

export interface RequestRunnerDeps {
  state: GatewayState;
  line: LineDef;
  lt: LineEscalations;
  log: GatewayLog;
  /** Starts the workflow a parked row names. */
  workflows: LineWorkflows;
  dispatcher: Pick<Dispatcher, 'tell' | 'assertLive'>;
  /** Throws once the gateway has stopped, so no row is raised after it. */
  live: () => void;
  /** Runs work detached, logging its failure. */
  track: (work: Promise<void>) => void;
  /** A timer the gateway clears when it stops. */
  schedule: (fn: () => void, ms: number) => void;
}

export class RequestRunner {
  constructor(private readonly d: RequestRunnerDeps) {}

  /**
   * The request's or notice's row, once per message: a repeat finds the row the
   * first one parked. While the row is open, its workflow starts, once per row,
   * before the message is confirmed, so a crash before the start redelivers it.
   */
  async park(a: Extract<Action, { kind: 'park' }>): Promise<WireAction> {
    this.d.live();
    const role = a.row.role || machineRole(machineById(this.d.line, a.machineId));
    const row = await this.d.lt.create(CONTROLLER, { ...a.row, role });
    const open = !row.status || row.status === PENDING;
    if (open && trackRequest(this.d.state, row.id, a.row.type, a.row.metadata, row.created_at)) {
      const event = a.row.type === ROW_TYPE.MACHINE_NOTICE ? GATEWAY_LOG.NOTICE_PARKED : GATEWAY_LOG.REQUEST_PARKED;
      this.d.log.info(event, { row: row.id, machine: a.machineId, ref: a.ref, subtype: a.row.subtype });
      this.watchLate(row.id);
    }
    const started = open && a.workflow ? await this.startWorkflow(a, row.id) : '';
    return { verb: 'create-row', rowId: row.id, detail: `${a.row.type} ${a.ref} for ${a.machineId}${row.status && !open ? ` (${row.status} already)` : ''}${started}` };
  }

  /** Start the row's workflow under its row's id; a configuration error is logged, anything else throws so the message comes again. */
  private async startWorkflow(a: Extract<Action, { kind: 'park' }>, rowId: string): Promise<string> {
    const md = a.row.metadata ?? {};
    const data: RowWorkflowInput = {
      rowId, type: a.row.type, siteId: md.siteId, lineId: md.lineId, machineId: a.machineId, ref: a.ref, event: md.event ?? {},
      ...(md.op ? { op: md.op } : {}),
    };
    const workflowId = rowWorkflowId(a.row.type, rowId);
    const context = { row: rowId, workflow: a.workflow!.type, workflowId };
    try {
      const outcome = await this.d.workflows.start(a.workflow!.type, workflowId, data as unknown as Record<string, unknown>);
      this.d.log.info(GATEWAY_LOG.ROW_WORKFLOW_STARTED, { ...context, outcome });
      return `, workflow ${a.workflow!.type} ${outcome}`;
    } catch (err) {
      if (!(err instanceof WorkflowStartRefused)) throw err;
      this.d.log.error(GATEWAY_LOG.ROW_WORKFLOW_FAILED, { ...context, error: err.message });
      return `, workflow ${a.workflow!.type} refused`;
    }
  }

  /** Raise the request's overdue row when its window passes, unless it has one or has ended. */
  watchLate(rowId: string): void {
    const track = this.d.state.requests.get(rowId);
    if (!track?.withinMs || track.overdue) return;
    this.d.schedule(() => this.d.track(this.raiseOverdue(rowId)), Math.max(0, track.createdAt + track.withinMs - Date.now()));
  }

  private async raiseOverdue(rowId: string): Promise<void> {
    const { state, line, lt, log } = this.d;
    const track = state.requests.get(rowId);
    if (!track || track.overdue) return;
    this.d.live();
    track.overdue = true;
    const waited = Math.round((Date.now() - track.createdAt) / 1000);
    const notice = track.type === ROW_TYPE.MACHINE_NOTICE;
    const row = await lt.create(CONTROLLER, {
      type: ROW_TYPE.REQUEST_OVERDUE, subtype: track.op ?? track.type, role: operatorRole(line), priority: 2,
      description: notice
        ? `${track.machineId}'s notice ${track.ref} has waited ${waited} s to be recorded`
        : `${track.machineId} has waited ${waited} s for an answer to ${track.ref}`,
      metadata: {
        siteId: line.siteId, lineId: line.lineId, machineId: track.machineId, requestId: rowId, rowType: track.type, ref: track.ref,
        ...(track.op ? { op: track.op } : {}),
      },
      signal_key: overdueSignalKey(rowId),
    });
    log.info(GATEWAY_LOG.REQUEST_OVERDUE, { row: row.id, request: rowId, machine: track.machineId, ref: track.ref });
    if (row.status && row.status !== PENDING) return;
    // Ended while the row was being created.
    if (!state.requests.has(rowId)) {
      await lt.resolve(CONTROLLER, row.id, { decision: overdueDecision(track.type), note: `${track.type} ${rowId} ended` });
      return;
    }
    track.overdueRowId ??= row.id;
  }

  /**
   * The answer a request row holds: sent once as the op it names, naming the
   * message it answers, and the row resolved as the controller. Nothing is
   * waited for. A row that holds no answer yet is left as it is.
   */
  async answer(a: Extract<Action, { kind: 'answer' }>): Promise<void> {
    const { state, lt, log, dispatcher } = this.d;
    const track = state.requests.get(a.rowId);
    if (!track?.op) return;
    try {
      const answer = readAnswer(await lt.items(a.rowId));
      dispatcher.assertLive();
      if (!answer) {
        track.sending = false;
        return;
      }
      const op = answer.op ?? track.op!;
      const allowed = rowOpsOf(state);
      const sent = allowed.includes(op) && await dispatcher.tell(track.machineId, op, answerCommandId(a.rowId), answer.args, track.ref);
      dispatcher.assertLive();
      const reason = !allowed.includes(op)
        ? `${op} is not a command an answer may be sent as; one of ${allowed.join(', ')}`
        : `the line's codec has no ${op} command`;
      const outcome: RequestResolution = {
        answered: sent, machineId: track.machineId, op, ref: track.ref,
        status: sent ? COMMAND_STATUS.SENT : COMMAND_STATUS.UNSUPPORTED, ...(sent ? {} : { reason }),
        ...(answer.actor ? { answeredBy: answer.actor } : {}),
      };
      const context = { row: a.rowId, machine: track.machineId, op, ref: track.ref, status: outcome.status };
      if (sent) log.info(GATEWAY_LOG.REQUEST_ANSWERED, context);
      else log.warn(GATEWAY_LOG.COMMAND_UNSUPPORTED, { ...context, reason });
      this.check(a.rowId, await lt.resolve(CONTROLLER, a.rowId, outcome as unknown as Record<string, any>));
    } catch (err) {
      track.sending = false;
      throw err;
    }
    for (const close of endRequest(state, a.rowId, `${track.machineId} was answered`)) {
      if (close.kind === 'resolve') this.check(close.rowId, await lt.resolve(close.as, close.rowId, close.payload));
    }
  }

  private check(rowId: string, result: VerbResult): void {
    if (result.outcome === VERB_OUTCOME.INVALID) this.d.log.error(GATEWAY_LOG.VERB_INVALID, { action: 'resolve', row: rowId, detail: result.detail });
  }
}
