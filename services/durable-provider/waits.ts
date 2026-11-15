import type { Pool, PoolClient } from 'pg';

import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import { isUuid } from '../../lib/uuid';
import type { LTEscalationRecord } from '../../types';
import type { LTOpenWaitInput } from '../../types/durable-provider';
import { ensureEscalationCompatView } from '../escalation/client';
import { announceCreated, hotMeshHoldsSignalKey } from '../escalation/crud';
import { withSignalKeyLock } from '../escalation/provider-waits';
import { toEscalationRecord } from '../escalation/map';
import { DURABLE_LOG, ESCALATION_STORE_NAMESPACE } from './constants';
import { foldWaitDeclaration } from './declaration';
import { GET_WAIT_BY_ESCALATION, OPEN_WAIT, SIGNAL_KEY_INDEX } from './sql';

const UNIQUE_VIOLATION = '23505';

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
 * (provider, workflowId, runScope, waitKey): a repeat naming the row's role
 * returns the same row. A `signalKey` is claimed under the signal key lock.
 */
export async function openWait(provider: string, input: LTOpenWaitInput, createdBy: string): Promise<OpenedWait> {
  const opened = input.signalKey
    ? await withSignalKeyLock(input.signalKey, (client) => openWaitOn(client, provider, input, createdBy))
    : await openWaitOn(getPool(), provider, input, createdBy);
  const context = { provider, workflowId: input.workflowId, waitKey: input.waitKey, escalationId: opened.escalation.id };
  if (opened.created) {
    announceCreated(opened.escalation);
    loggerRegistry.info(DURABLE_LOG.WAIT_OPENED, context);
  } else if (opened.reopened) {
    loggerRegistry.info(DURABLE_LOG.WAIT_REOPENED, context);
  }
  return opened;
}

async function openWaitOn(db: Pool | PoolClient, provider: string, input: LTOpenWaitInput, createdBy: string): Promise<OpenedWait> {
  const { metadata, envelope } = foldWaitDeclaration(input);
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
    metadata ? JSON.stringify(metadata) : null,
    input.data ? JSON.stringify(input.data) : null,
    createdBy,
    input.expiresAt ?? null,
    JSON.stringify(envelope),
    input.assignee ?? null,
    input.durationMinutes ?? null,
    input.originId ?? null,
    input.parentId ?? null,
    input.signalKey ?? null,
  ];
  for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
    const { rows } = await queryOpenWait(db, params, input.signalKey);
    if (!rows.length) {
      if (input.signalKey && await hotMeshHoldsSignalKey(input.signalKey)) throw new SignalKeyTakenError(input.signalKey);
      continue;
    }
    const { created, reopened, ...entry } = rows[0];
    const escalation = toEscalationRecord(entry);
    if (!created && escalation.role !== input.role) throw new WaitRoleError(input.waitKey, input.workflowId);
    return { escalation, created: Boolean(created), reopened: Boolean(reopened) };
  }
  throw new Error(`could not open wait ${input.waitKey} for workflow ${input.workflowId}`);
}

/** A signal key another wait or a HotMesh escalation already holds. */
export class SignalKeyTakenError extends Error {
  constructor(signalKey: string) {
    super(`signal key ${signalKey} is held by another escalation`);
    this.name = 'SignalKeyTakenError';
  }
}

/** A repeat open naming a role other than the one the wait was opened under. */
export class WaitRoleError extends Error {
  constructor(waitKey: string, workflowId: string) {
    super(`wait ${waitKey} of workflow ${workflowId} is open under another role`);
    this.name = 'WaitRoleError';
  }
}

async function queryOpenWait(db: Pool | PoolClient, params: unknown[], signalKey: string | undefined) {
  try {
    return await db.query(OPEN_WAIT, params);
  } catch (err: any) {
    if (signalKey && err?.code === UNIQUE_VIOLATION && err?.constraint === SIGNAL_KEY_INDEX) throw new SignalKeyTakenError(signalKey);
    throw err;
  }
}

/** The wait behind an escalation, or null when the row is not a provider wait. */
export async function getWaitByEscalationId(escalationId: string): Promise<DurableWaitRow | null> {
  if (!isUuid(escalationId)) return null;
  const { rows } = await getPool().query(GET_WAIT_BY_ESCALATION, [escalationId]);
  return rows[0] ?? null;
}
