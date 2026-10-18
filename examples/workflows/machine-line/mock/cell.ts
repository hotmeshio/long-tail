/**
 * One station: the dispatch queue, unit arrival and the job lifecycle with
 * its measurements and the material lots consumed. A job carries one or more
 * units through the machine together; it starts when every unit is present.
 * A unit is only worked after it was dispatched; the floor moves units.
 */

import { JOB_EVENT, JOB_RESULT, LEVEL, MODE, REPLY_STATUS, TRANSFER_FAILURE, isoTs, type JobResult, type ReplyStatus } from '../../../../lib/machines/protocol';
import { CARRIER_ROLE } from '../../../../lib/machines/line';
import type { MockMachine } from './machine';

export const JOB_STATUS = { QUEUED: 'queued', RUNNING: 'running', DONE: 'done' } as const;
type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

export const UNIT_STATUS = { EXPECTED: 'expected', PRESENT: 'present', DONE: 'done', GONE: 'gone' } as const;
type UnitStatus = typeof UNIT_STATUS[keyof typeof UNIT_STATUS];

export interface JobUnit {
  unitId: string;
  carrierId: string | null;
  status: UnitStatus;
  result?: JobResult;
}

export interface Job {
  jobId: string;
  orderRef: string;
  recipe: { id: string; version: string };
  from: string | null;
  units: JobUnit[];
  status: JobStatus;
  startedAt?: number;
}

export interface ArmedResult {
  result: JobResult;
  reason?: string;
}

export type Reply = { status: ReplyStatus; reason: string };

export const CANCELLED_REASON = 'cancelled';
/** Modes in which a machine takes no new work. */
const REFUSING_MODES: string[] = [MODE.MAINTENANCE, MODE.EMERGENCY_STOP];

export class Cell {
  readonly jobs = new Map<string, Job>();
  station: Job | null = null;
  armed: ArmedResult[] = [];
  private cycleTimer?: NodeJS.Timeout;
  private progressTimer?: NodeJS.Timeout;

  constructor(private readonly m: MockMachine) {}

  jobForUnit(unitId: string): Job | undefined {
    return [...this.jobs.values()].find((j) => j.units.some((u) => u.unitId === unitId));
  }

  /** The station can take a unit of `job`: empty, or gathering this job's units. */
  canTake(job: Job): boolean {
    return (!this.station || this.station === job) && job.status === JOB_STATUS.QUEUED;
  }

  async dispatch(a: Record<string, any>): Promise<Reply> {
    const missing = ['jobId', 'orderRef', 'recipe'].filter((k) => !a[k]);
    if (!Array.isArray(a.units) || a.units.length === 0) missing.push('units');
    if (missing.length) return { status: REPLY_STATUS.REFUSED, reason: `missing ${missing.join(', ')}` };
    if (REFUSING_MODES.includes(this.m.mode)) return { status: REPLY_STATUS.REFUSED, reason: `${this.m.def.machineId} is in ${this.m.mode}` };
    const { id: recipeId, version } = a.recipe;
    if (!this.m.recipes[recipeId]?.includes(String(version))) {
      return { status: REPLY_STATUS.REFUSED, reason: `recipe ${recipeId} v${version} is not held` };
    }
    const existing = this.jobs.get(a.jobId);
    if (existing) {
      if (existing.status !== JOB_STATUS.QUEUED) return { status: REPLY_STATUS.REFUSED, reason: `job ${a.jobId} is ${existing.status}` };
      this.expectUnits(existing);
      return { status: REPLY_STATUS.ACCEPTED, reason: 'job already queued' };
    }
    if (this.jobs.size >= this.m.settings.queueCapacity) return { status: REPLY_STATUS.REFUSED, reason: 'queue full' };
    const artifact = await this.m.payloads.verify(a.artifact?.url, a.artifact?.sha256);
    if (!artifact.ok) return { status: REPLY_STATUS.FAILED, reason: artifact.detail };
    const job: Job = {
      jobId: a.jobId, orderRef: a.orderRef, recipe: { id: recipeId, version: String(version) }, from: a.from ?? null,
      units: a.units.map((u: any) => ({ unitId: u.unitId, carrierId: u.carrierId ?? null, status: UNIT_STATUS.EXPECTED })),
      status: JOB_STATUS.QUEUED,
    };
    this.jobs.set(job.jobId, job);
    for (const u of job.units) await this.publishJob(JOB_EVENT.QUEUED, job, u);
    this.expectUnits(job);
    return { status: REPLY_STATUS.ACCEPTED, reason: `queued ${job.jobId}` };
  }

  /** Cancel: a queued job is withdrawn; a running one stops at a safe point and finishes on hold. */
  async cancel(jobId: string): Promise<Reply> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: REPLY_STATUS.REFUSED, reason: `unknown job ${jobId}` };
    if (job.status === JOB_STATUS.RUNNING) {
      await this.finish(job, { result: JOB_RESULT.HOLD, reason: CANCELLED_REASON });
      return { status: REPLY_STATUS.ACCEPTED, reason: `stopped ${jobId} at a safe point; units held` };
    }
    if (job.status !== JOB_STATUS.QUEUED) return { status: REPLY_STATUS.REFUSED, reason: `job ${jobId} is ${job.status}` };
    await this.withdraw(job);
    return { status: REPLY_STATUS.ACCEPTED, reason: `withdrew ${jobId}` };
  }

  /** The job leaves the queue (cancelled, or given up by the machine). */
  async withdraw(job: Job): Promise<void> {
    this.jobs.delete(job.jobId);
    for (const u of job.units) this.m.floor.unexpect(u.unitId, this.m, job);
    if (this.station === job) this.station = null;
    for (const u of job.units) await this.publishJob(JOB_EVENT.WITHDRAWN, job, u);
    this.m.floor.poke();
  }

  /** A unit physically reaching the station. False when it is refused. */
  async receive(unitId: string, carrierId: string | null, from: string | null): Promise<boolean> {
    const job = this.jobForUnit(unitId);
    const unit = job?.units.find((u) => u.unitId === unitId);
    if (!job || !unit || unit.status !== UNIT_STATUS.EXPECTED || job.status !== JOB_STATUS.QUEUED) {
      await this.m.alarms.raise('UNIT-NOT-DISPATCHED', LEVEL.WARNING, `refused ${unitId}: no job for it here`);
      return false;
    }
    if (!this.canTake(job)) return false;
    if (unit.carrierId && carrierId && unit.carrierId !== carrierId) {
      await this.publishJob(JOB_EVENT.TRANSFER_FAILED, job, unit, { peer: from, failure: TRANSFER_FAILURE.CARRIER_MISMATCH });
      await this.m.alarms.raise('CARRIER-MISMATCH', LEVEL.WARNING, `${unitId} arrived on ${carrierId}, expected ${unit.carrierId}`);
      return false;
    }
    unit.status = UNIT_STATUS.PRESENT;
    this.station = job;
    await this.publishJob(JOB_EVENT.ARRIVED, job, unit, { peer: from });
    await this.maybeStart();
    return true;
  }

  /** The unit is at the infeed but its id cannot be read: refused. */
  async refuseUnreadable(unitId: string, from: string | null): Promise<void> {
    const job = this.jobForUnit(unitId);
    const unit = job?.units.find((u) => u.unitId === unitId);
    if (job && unit) await this.publishJob(JOB_EVENT.TRANSFER_FAILED, job, unit, { peer: from, failure: TRANSFER_FAILURE.UNREADABLE_ID });
  }

  async announceReady(job: Job, unitId: string): Promise<void> {
    const unit = job.units.find((u) => u.unitId === unitId);
    if (unit) await this.publishJob(JOB_EVENT.READY, job, unit, { peer: job.from });
  }

  async maybeStart(): Promise<void> {
    const job = this.station;
    if (!job || job.status !== JOB_STATUS.QUEUED || !this.m.canProduce()) return;
    if (job.units.some((u) => u.status !== UNIT_STATUS.PRESENT)) return;
    job.status = JOB_STATUS.RUNNING;
    if (this.m.recipeKey() !== `${job.recipe.id}@${job.recipe.version}`) {
      await this.m.setMode(MODE.CHANGEOVER);
      this.m.loadRecipe(job.recipe);
      this.cycleTimer = this.m.timers.after(this.m.ms(this.m.def.changeoverSec), () => void this.run(job));
    } else {
      await this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    if (job.status !== JOB_STATUS.RUNNING) return;
    await this.m.setMode(MODE.RUNNING);
    job.startedAt = Date.now();
    for (const u of job.units) await this.publishJob(JOB_EVENT.STARTED, job, u);
    const every = this.m.def.progressEverySec;
    if (every) {
      this.progressTimer = this.m.timers.every(this.m.ms(every), () => {
        for (const u of job.units) void this.publishJob(JOB_EVENT.PROGRESS, job, u);
      });
    }
    this.cycleTimer = this.m.timers.after(this.m.ms(this.m.def.cycleSec), () => void this.finish(job));
  }

  /** Stop the job in process (fault or emergency stop): its units finish on hold. */
  async interrupt(reason: string): Promise<void> {
    const job = this.station;
    if (job?.status === JOB_STATUS.RUNNING) await this.finish(job, { result: JOB_RESULT.HOLD, reason });
  }

  private nextResult(): ArmedResult {
    const armed = this.armed.shift();
    if (armed) return armed;
    if (Math.random() < this.m.settings.failRate) return { result: JOB_RESULT.REJECT };
    return { result: JOB_RESULT.OK };
  }

  private async finish(job: Job, forced?: ArmedResult): Promise<void> {
    if (job.status !== JOB_STATUS.RUNNING) return;
    this.m.timers.cancel(this.cycleTimer);
    this.m.timers.cancel(this.progressTimer);
    const startedAt = job.startedAt ?? Date.now();
    const endedAt = Date.now();
    job.status = JOB_STATUS.DONE;
    for (const u of job.units) {
      const { result, reason } = forced ?? this.nextResult();
      const ok = result === JOB_RESULT.OK;
      u.status = UNIT_STATUS.DONE;
      u.result = result;
      await this.publishJob(JOB_EVENT.FINISHED, job, u, {
        result, reason: ok ? null : reason ?? this.m.def.rejectReason,
        measurements: this.m.measure(ok), materials: this.m.def.materials.map((x) => ({ ...x })),
        startedAt: isoTs(startedAt), endedAt: isoTs(endedAt), durationMs: endedAt - startedAt,
      });
      this.m.recordCycle(ok);
    }
    if (this.m.mode === MODE.RUNNING) await this.m.setMode(MODE.IDLE);
    const freesCarrier = this.m.def.carrier === CARRIER_ROLE.RELEASE;
    for (const u of job.units) {
      if (u.result === JOB_RESULT.OK) this.m.floor.hold(this.m, job, u.unitId, freesCarrier ? null : u.carrierId);
    }
  }

  /** A unit leaves the station toward `to` (null: taken off the line). */
  async release(job: Job, unitId: string, to: string | null): Promise<void> {
    const unit = job.units.find((u) => u.unitId === unitId);
    if (!unit) return;
    await this.publishJob(JOB_EVENT.RELEASED, job, unit, { peer: to });
    unit.status = UNIT_STATUS.GONE;
    if (job.units.every((u) => u.status === UNIT_STATUS.GONE)) {
      if (this.station === job) this.station = null;
      this.jobs.delete(job.jobId);
    }
    this.m.floor.poke();
  }

  /** An operator takes a finished or held unit off the line. */
  async unload(unitId: string): Promise<boolean> {
    const job = this.station;
    const unit = job?.units.find((u) => u.unitId === unitId);
    if (!job || !unit || unit.status !== UNIT_STATUS.DONE) return this.m.floor.takeBack(unitId, this.m);
    this.m.floor.drop(unitId);
    await this.release(job, unitId, null);
    return true;
  }

  /** The machine controller restarts: queue and station are lost. */
  forget(): void {
    this.m.timers.cancel(this.cycleTimer);
    this.m.timers.cancel(this.progressTimer);
    for (const job of this.jobs.values()) for (const u of job.units) this.m.floor.unexpect(u.unitId, this.m, job);
    this.jobs.clear();
    this.station = null;
  }

  async publishJob(event: string, job: Job, unit: JobUnit, extra: Record<string, any> = {}): Promise<void> {
    this.m.snapshotChanged();
    await this.m.publishJob({
      event, jobId: job.jobId, unitId: unit.unitId, orderRef: job.orderRef,
      recipe: job.recipe, carrierId: unit.carrierId, ...extra,
    });
  }

  private expectUnits(job: Job): void {
    for (const u of job.units) if (u.status === UNIT_STATUS.EXPECTED) this.m.floor.expect(this.m, job, u.unitId, u.carrierId);
  }
}
