import { getPool } from '../../lib/db';
import { FOLLOW_DEFAULTS } from './constants';
import { CLAIM_DUE_FOLLOWS, RECORD_FOLLOW, REMOVE_FOLLOW } from './sql';

export interface DueFollow {
  workflow_id: string;
  workflow_type: string | null;
}

/** Follow a workflow until its completion is published. Returns true when the follow is new. */
export async function recordFollow(provider: string, workflowId: string, workflowType: string): Promise<boolean> {
  const { rows } = await getPool().query<{ created: boolean }>(RECORD_FOLLOW, [
    provider, workflowId, workflowType, FOLLOW_DEFAULTS.SWEEP_AFTER_MS,
  ]);
  return Boolean(rows[0]?.created);
}

/** Take the follows due for a check; each moves to its next check time as it is taken. */
export async function claimDueFollows(provider: string, batch: number = FOLLOW_DEFAULTS.SWEEP_BATCH): Promise<DueFollow[]> {
  const { rows } = await getPool().query<DueFollow>(CLAIM_DUE_FOLLOWS, [
    provider, batch, FOLLOW_DEFAULTS.SWEEP_AFTER_MS, FOLLOW_DEFAULTS.SWEEP_BACKOFF_MAX_MS,
  ]);
  return rows;
}

/** Remove a follow. Returns its row to the one caller that removed it, null to every other. */
export async function removeFollow(provider: string, workflowId: string): Promise<{ workflow_type: string | null } | null> {
  const { rows } = await getPool().query<{ workflow_type: string | null }>(REMOVE_FOLLOW, [provider, workflowId]);
  return rows[0] ?? null;
}
