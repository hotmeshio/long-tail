/**
 * Job lifecycle on the row. A machine's started and progress events, and the
 * alarms that stop it, are noted as items on the open row that holds the job:
 * the accepted dispatch into the machine until its units arrive, then the
 * handoff out of it. Progress is noted only when it crosses a step, or reaches
 * a named stage it has not reached before, so a row carries a handful of items
 * while the stream keeps every report.
 *
 * Off unless the line turns it on (MACHINE_LIFECYCLE=on). A row parked with a
 * limit on its items gets no notes, so they never use a slot its units need.
 */

import { LIFECYCLE_FACET, itemKeys } from '../contracts';
import { JOB_EVENT } from '../../../lib/machines/protocol';
import type { Action } from './actions';
import { jobOwns } from './jobs';
import { DISPATCH_STATE, type AlarmTrack, type GatewayState, type HandoffRow } from './state';

const owns = (jobId: string | null, reported: unknown) => !jobId || typeof reported !== 'string' || jobOwns(jobId, reported);

const runningAt = (r: HandoffRow, m: string, jobId: unknown) =>
  r.toMachine === m && r.dispatch === DISPATCH_STATE.ACCEPTED && owns(r.jobId, jobId);

const leavingFrom = (r: HandoffRow, m: string, jobId: unknown) =>
  r.fromMachine === m && !!r.senderJobId && owns(r.senderJobId, jobId);

/** The open row holding `unitId` at `m`: its accepted dispatch, else the handoff out of `m`. */
function holderRow(state: GatewayState, m: string, unitId: string, jobId: unknown): HandoffRow | undefined {
  return state.openFor(unitId, (r) => runningAt(r, m, jobId)) ?? state.openFor(unitId, (r) => leavingFrom(r, m, jobId));
}

/** The progress step `percent` has reached; null below the first step, at 100, or when steps are off. */
export function progressStepOf(percent: unknown, step: number): number | null {
  if (step <= 0 || typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  const reached = Math.floor(percent / step) * step;
  return reached > 0 && reached < 100 ? reached : null;
}

/** An item the row does not hold yet, added as the machine. */
function note(row: HandoffRow, m: string, itemKey: string, payload: Record<string, any>, metadata?: Record<string, any>): Action[] {
  if (row.capped || row.noted?.includes(itemKey)) return [];
  row.noted = [...(row.noted ?? []), itemKey];
  return [{ kind: 'accumulate', as: m, rowId: row.id, itemKey, payload, ...(metadata ? { metadata } : {}) }];
}

/** A started or progress event, noted on the row that holds the job. */
export function noteJobEvent(state: GatewayState, m: string, b: Record<string, any>, at: string | undefined): Action[] {
  const unitId = b.unitId;
  if (!state.lifecycle || typeof unitId !== 'string') return [];
  const row = holderRow(state, m, unitId, b.jobId);
  if (!row) return [];
  const when = at ?? new Date().toISOString();
  if (b.event === JOB_EVENT.STARTED) {
    return note(row, m, itemKeys.started(unitId), { unitId, jobId: b.jobId ?? null, at: when });
  }
  const step = progressStepOf(b.percent, state.progressStep);
  const stage = typeof b.stage === 'string' && b.stage ? b.stage : null;
  if (step === null && stage === null) return [];
  const progress = {
    ...(typeof b.percent === 'number' ? { percent: b.percent } : {}), remainingSec: b.remainingSec ?? null, ...(stage ? { stage } : {}), at: when,
    ...(b.detail && typeof b.detail === 'object' ? { detail: b.detail } : {}),
  };
  const facet = { [LIFECYCLE_FACET.PROGRESS]: progress };
  const job = { unitId, jobId: b.jobId ?? null };
  return [
    ...(step === null ? [] : note(row, m, itemKeys.progress(unitId, step), { ...job, step, ...progress }, facet)),
    ...(stage === null ? [] : note(row, m, itemKeys.stage(unitId, stage), { ...job, ...progress }, facet)),
  ];
}

/** Rows a stopping alarm pauses: those running or leaving with its job, or every row the machine holds. */
export function notePause(state: GatewayState, track: AlarmTrack, b: Record<string, any>): Action[] {
  if (!state.lifecycle) return [];
  const m = track.machineId;
  const jobId = typeof b.jobId === 'string' ? b.jobId : undefined;
  const rows = state.open().filter((r) => runningAt(r, m, jobId) || leavingFrom(r, m, jobId));
  track.noted = rows.map((r) => r.id);
  const payload = { alarmId: track.alarmId, code: b.code ?? null, level: b.level ?? null, text: b.text ?? null, raisedAt: b.raisedAt ?? null };
  return rows.flatMap((r) => note(r, m, itemKeys.paused(track.alarmId, String(b.raisedAt ?? '')), payload));
}

/** The machine cleared an alarm: the rows it paused, still open, note the resume. */
export function noteResume(state: GatewayState, track: AlarmTrack, b: Record<string, any>): Action[] {
  const key = itemKeys.resumed(track.alarmId, String(track.raisedAt ?? ''));
  const payload = { alarmId: track.alarmId, clearedAt: b.clearedAt ?? new Date().toISOString(), clearedBy: b.clearedBy ?? null };
  return (track.noted ?? [])
    .map((id) => state.get(id))
    .filter((r): r is HandoffRow => !!r && !r.ended)
    .flatMap((r) => note(r, track.machineId, key, payload));
}
