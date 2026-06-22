import { diagnoseJob, findStalledJobs, findOrphanedSignals } from '../services/diagnostics';
import type { LTApiResult } from '../types/sdk';

export async function diagnose(input: {
  workflowId: string;
  appId?: string;
}): Promise<LTApiResult> {
  try {
    const diagnosis = await diagnoseJob(input.workflowId, input.appId);
    return { status: 200, data: diagnosis };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function stalledJobs(input: {
  appId?: string;
  stalledMinutes?: number;
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
  limit?: number;
}): Promise<LTApiResult> {
  try {
    const result = await findOrphanedSignals(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
