/**
 * How a handoff's units become machine jobs. A codec that takes one unit per
 * dispatch gets one job per unit, each with its own job id and command id;
 * otherwise the units travel as one job. The split is deterministic, so a
 * cancel or a re-dispatch names the same jobs the dispatch did.
 */

import type { HandoffUnit } from '../contracts';

export interface DispatchJob {
  jobId: string;
  units: HandoffUnit[];
  /** Appended to command ids so each job's reply is told apart; empty when unsplit. */
  suffix: string;
}

export function dispatchJobs(jobId: string, units: HandoffUnit[], perDispatch: number | null): DispatchJob[] {
  if (!perDispatch || units.length <= perDispatch) return [{ jobId, units, suffix: '' }];
  const jobs: DispatchJob[] = [];
  for (let i = 0; i < units.length; i += perDispatch) {
    const n = jobs.length + 1;
    jobs.push({ jobId: `${jobId}#${n}`, units: units.slice(i, i + perDispatch), suffix: `#${n}` });
  }
  return jobs;
}
