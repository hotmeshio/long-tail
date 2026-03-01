import type { Request, Response } from 'express';

import { resolveWorkflowHandle } from '../services/task';
import type { ResolvedHandle } from '../services/task';

/**
 * Resolve the (taskQueue, workflowName) pair for a workflowId.
 *
 * Looks up the task record in lt_tasks — the workflowId is enough.
 * Sends a 404 response and returns null if the workflow can't be found.
 */
export async function resolveHandle(
  req: Request,
  res: Response,
): Promise<ResolvedHandle | null> {
  try {
    return await resolveWorkflowHandle(req.params.workflowId as string);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
    return null;
  }
}
