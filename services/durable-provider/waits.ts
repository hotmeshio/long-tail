import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { isUuid } from '../../lib/uuid';
import type { LTEscalationRecord } from '../../types';
import type { LTOpenWaitInput } from '../../types/durable-provider';
import { ensureEscalationCompatView } from '../escalation/client';
import { announceCreated } from '../escalation/crud';
import { toEscalationRecord } from '../escalation/map';
import { DURABLE_LOG, ESCALATION_STORE_NAMESPACE } from './constants';
import { GET_WAIT_BY_ESCALATION, OPEN_WAIT } from './sql';

export interface DurableWaitRow {
  escalation_id: string;
  provider: string;
  workflow_id: string;
  run_scope: string;
  wait_key: string;
  workflow_type: string | null;
  delivered_at: Date | null;
  delivery: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
}

export interface OpenedWait {
  escalation: LTEscalationRecord;
  created: boolean;
  reopened: boolean;
}

const OPEN_ATTEMPTS = 3;

/**
 * Open a wait for a workflow on `provider`. Idempotent on
 * (provider, workflowId, runScope, waitKey): a repeat returns the same row.
 */
export async function openWait(provider: string, input: LTOpenWaitInput, createdBy: string): Promise<OpenedWait> {
  await ensureEscalationCompatView();
  const params = [
    provider,
    input.workflowId,
    input.runScope ?? '',
    input.waitKey,
    input.workflowType ?? null,
    ESCALATION_STORE_NAMESPACE,
    input.type,
    input.subtype ?? input.type,
    input.description ?? null,
    input.role,
    input.priority ?? 2,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.data ? JSON.stringify(input.data) : null,
    createdBy,
    input.expiresAt ?? null,
  ];
  for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
    const { rows } = await getPool().query(OPEN_WAIT, params);
    if (!rows.length) continue;
    const { created, reopened, ...entry } = rows[0];
    const escalation = toEscalationRecord(entry);
    if (created) {
      announceCreated(escalation);
      loggerRegistry.info(DURABLE_LOG.WAIT_OPENED, { provider, workflowId: input.workflowId, waitKey: input.waitKey, escalationId: escalation.id });
    } else if (reopened) {
      loggerRegistry.info(DURABLE_LOG.WAIT_REOPENED, { provider, workflowId: input.workflowId, waitKey: input.waitKey, escalationId: escalation.id });
    }
    return { escalation, created: Boolean(created), reopened: Boolean(reopened) };
  }
  throw new Error(`could not open wait ${input.waitKey} for workflow ${input.workflowId}`);
}

/** The wait behind an escalation, or null when the row is not a provider wait. */
export async function getWaitByEscalationId(escalationId: string): Promise<DurableWaitRow | null> {
  if (!isUuid(escalationId)) return null;
  const { rows } = await getPool().query(GET_WAIT_BY_ESCALATION, [escalationId]);
  return rows[0] ?? null;
}
