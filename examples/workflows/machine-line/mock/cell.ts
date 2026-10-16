/**
 * One station: the dispatch queue, unit arrival and the job lifecycle with
 * its measurements and the material lots consumed. A unit is only worked
 * after it was dispatched; the floor moves units between stations.
 */

import { JOB_EVENT, JOB_RESULT, LEVEL, MODE, REPLY_STATUS, TRANSFER_FAILURE, isoTs, type JobResult, type ReplyStatus } from '../protocol';
import { CARRIER_ROLE } from '../line';
import type { MockMachine } from './machine';

export const JOB_STATUS = { QUEUED: 'queued', PRESENT: 'present', RUNNING: 'running', DONE: 'done' } as const;
type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

export interface Job {
  jobId: string;
  unitId: string;
  orderRef: string;
  recipe: { id: string; version: string };
  carrierId: string | null;
  from: string | null;
  status: JobStatus;
  startedAt?: number;
  result?: JobResult;
}

export interface ArmedResult {
  result: JobResult;
  reason?: string;
}

export type Reply = { status: ReplyStatus; reason: string };

export class Cell {
  readonly jobs = new Map<string, Job>();
  station: Job | null = null;
  armed: ArmedResult[] = [];
  private cycleTimer?: NodeJS.Timeout;
  private progressTimer?: NodeJS.Timeout;

  constructor(private readonly m: MockMachine) {}

  jobForUnit(unitId: string): Job | undefined {
    return [...this.jobs.values()].find((j) => j.unitId === unitId);
  }

  async dispatch(a: Record<string, any>): Promise<Reply> {
    const missing = ['jobId', 'unitId', 'orderRef', 'recipe'].filter((k) => !a[k]);
    if (missing.length) return { status: REPLY_STATUS.REFUSED, reason: `missing ${missing.join(', ')}` };
    const { id: recipeId, version } = a.recipe;
    if (!this.m.recipes[recipeId]?.includes(String(version))) {
      return { status: REPLY_STATUS.REFUSED, reason: `recipe ${recipeId} v${version} is not held` };
    }
    const existing = this.jobs.get(a.jobId);
    if (existing) {
      if (existing.status === JOB_STATUS.DONE) return { status: REPLY_STATUS.REFUSED, reason: 'job already finished' };
      if (existing.status === JOB_STATUS.QUEUED) this.m.floor.expect(this.m, existing);
      return { status: REPLY_STATUS.ACCEPTED, reason: 'job already queued' };
    }
    if (this.jobs.size >= this.m.settings.queueCapacity) return { status: REPLY_STATUS.REFUSED, reason: 'queue full' };
    const artifact = await this.m.payloads.verify(a.artifact?.url, a.artifact?.sha256);
    if (!artifact.ok) return { status: REPLY_STATUS.FAILED, reason: artifact.detail };
    const job: Job = {
      jobId: a.jobId, unitId: a.unitId, orderRef: a.orderRef, recipe: { id: recipeId, version: String(version) },
      carrierId: a.carrierId ?? null, from: a.from ?? null, status: JOB_STATUS.QUEUED,
    };
    this.jobs.set(job.jobId, job);
    await this.publishJob(JOB_EVENT.QUEUED, job);
    this.m.floor.expect(this.m, job);
    return { status: REPLY_STATUS.ACCEPTED, reason: `queued ${job.jobId}` };
  }

  async cancel(jobId: string): Promise<Reply> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: REPLY_STATUS.REFUSED, reason: `unknown job ${jobId}` };
    if (job.status !== JOB_STATUS.QUEUED) return { status: REPLY_STATUS.REFUSED, reason: `job ${jobId} is ${job.status}` };
    this.jobs.delete(jobId);
    this.m.floor.unexpect(job.unitId);
    await this.publishJob(JOB_EVENT.WITHDRAWN, job);
    return { status: REPLY_STATUS.ACCEPTED, reason: `withdrew ${jobId}` };
  }

  /** A unit physically reaching the station. False when it is refused. */
  async receive(unitId: string, carrierId: string | null, from: string | null): Promise<boolean> {
    const job = this.jobForUnit(unitId);
    if (!job || job.status !== JOB_STATUS.QUEUED) {
      await this.m.alarms.raise('UNIT-NOT-DISPATCHED', LEVEL.WARNING, `refused ${unitId}: no job for it here`);
      return false;
    }
    if (this.station) return false;
    if (job.carrierId && carrierId && job.carrierId !== carrierId) {
      await this.publishJob(JOB_EVENT.TRANSFER_FAILED, job, { peer: from, failure: TRANSFER_FAILURE.CARRIER_MISMATCH });
      await this.m.alarms.raise('CARRIER-MISMATCH', LEVEL.WARNING, `${unitId} arrived on ${carrierId}, expected ${job.carrierId}`);
      return false;
    }
    job.status = JOB_STATUS.PRESENT;
    this.station = job;
    await this.publishJob(JOB_EVENT.ARRIVED, job, { peer: from });
    await this.maybeStart();
    return true;
  }

  async announceReady(job: Job): Promise<void> {
    await this.publishJob(JOB_EVENT.READY, job, { peer: job.from });
  }

  async maybeStart(): Promise<void> {
    const job = this.station;
    if (!job || job.status !== JOB_STATUS.PRESENT || !this.m.canProduce()) return;
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
    await this.m.setMode(MODE.RUNNING);
    job.startedAt = Date.now();
    await this.publishJob(JOB_EVENT.STARTED, job);
    const every = this.m.def.progressEverySec;
    if (every) this.progressTimer = this.m.timers.every(this.m.ms(every), () => void this.publishJob(JOB_EVENT.PROGRESS, job));
    this.cycleTimer = this.m.timers.after(this.m.ms(this.m.def.cycleSec), () => void this.finish(job));
  }

  /** Stop the unit in process (fault or emergency stop): it finishes on hold. */
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
    const { result, reason } = forced ?? this.nextResult();
    const ok = result === JOB_RESULT.OK;
    const startedAt = job.startedAt ?? Date.now();
    const endedAt = Date.now();
    job.status = JOB_STATUS.DONE;
    job.result = result;
    await this.publishJob(JOB_EVENT.FINISHED, job, {
      result, reason: ok ? null : reason ?? this.m.def.rejectReason,
      measurements: this.m.measure(ok), materials: this.m.def.materials.map((x) => ({ ...x })),
      startedAt: isoTs(startedAt), endedAt: isoTs(endedAt), durationMs: endedAt - startedAt,
    });
    this.m.recordCycle(ok);
    if (this.m.mode === MODE.RUNNING) await this.m.setMode(MODE.IDLE);
    const carrierAfter = this.m.def.carrier === CARRIER_ROLE.RELEASE ? null : job.carrierId;
    if (ok) this.m.floor.hold(this.m, job, carrierAfter);
  }

  /** The unit leaves the station toward `to` (null: taken off the line). */
  async release(job: Job, to: string | null): Promise<void> {
    await this.publishJob(JOB_EVENT.RELEASED, job, { peer: to });
    if (this.station === job) this.station = null;
    this.jobs.delete(job.jobId);
    this.m.floor.poke();
  }

  /** An operator takes the unit at the station off the line. */
  async unload(unitId: string): Promise<boolean> {
    const job = this.station;
    if (!job || job.unitId !== unitId) return false;
    this.m.floor.drop(unitId);
    await this.release(job, null);
    return true;
  }

  async publishJob(event: string, job: Job, extra: Record<string, any> = {}): Promise<void> {
    this.m.snapshotChanged();
    await this.m.publishJob({
      event, jobId: job.jobId, unitId: job.unitId, orderRef: job.orderRef,
      recipe: job.recipe, carrierId: job.carrierId, ...extra,
    });
  }
}
