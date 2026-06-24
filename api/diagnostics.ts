import { diagnoseJob, findStalledJobs, findOrphanedSignals } from '../services/diagnostics';
import type { DiagnoseSection, DiagnoseVerbosity } from '../services/diagnostics';
import type { LTApiResult } from '../types/sdk';

export async function diagnose(input: {
  workflowId: string;
  appId?: string;
  maxEvents?: number;
  /** Heavy sections to include (events, streams). Default: verdict only. */
  include?: DiagnoseSection[];
  /** Shorthand: 'full' includes events + streams; 'summary' (default) includes neither. */
  verbosity?: DiagnoseVerbosity;
}): Promise<LTApiResult> {
  try {
    const diagnosis = await diagnoseJob(input.workflowId, input.appId, {
      maxEvents: input.maxEvents,
      include: input.include,
      verbosity: input.verbosity,
    });
    return { status: 200, data: diagnosis };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function stalledJobs(input: {
  appId?: string;
  idleMinutes?: number;
  workflowType?: string;
  limit?: number;
}): Promise<LTApiResult> {
  try {
    const result = await findStalledJobs(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function orphanedSignals(input: {
  appId?: string;
  withinHours?: number;
  limit?: number;
}): Promise<LTApiResult> {
  try {
    const result = await findOrphanedSignals(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
