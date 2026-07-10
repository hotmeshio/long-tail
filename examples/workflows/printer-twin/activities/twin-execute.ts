/**
 * The reconcile executor — turns the pure `ReconcileAction[]` into real effects:
 * Bambu commands (via the bambu-client) and escalation I/O (via the SDK). Kept
 * injectable (deps) so the whole poll→reconcile→execute loop is testable
 * in-process against a fake escalation store + the deterministic mock backend,
 * with no database.
 */

import { reportPrintOutcome } from './twin';
import type { BambuClient } from './bambu-client';
import { TWIN_WORKFLOWS } from '../types';
import type { Mirror, TwinObservation, ReconcileAction, EscalationObservation, EscalationKind } from '../mirror';

/** The subset of the SDK escalations surface the twin executor needs. */
export interface LtLike {
  escalations: {
    get(input: { id: string }): Promise<{ status: number; data?: any; error?: string }>;
    create(input: any): Promise<{ status: number; data?: any; error?: string }>;
    resolve(input: { id: string; resolverPayload: any }): Promise<{ status: number; data?: any; error?: string }>;
  };
}

export interface ExecDeps {
  lt: LtLike;
  client: BambuClient;
  operatorId: string;
  workflowId: string;
  /** Injectable so tests can record broker reports without the DB. */
  reportOutcome?: (input: {
    callbackKey: string;
    outcome: 'success' | 'fail' | 'cancel';
    printerId: string;
    jobId: string;
    orderId: string;
    unitIndex: number;
  }) => Promise<void>;
}

function parsePayload(p: unknown): Record<string, unknown> | undefined {
  if (p == null) return undefined;
  if (typeof p === 'string') {
    try {
      return JSON.parse(p);
    } catch {
      return undefined;
    }
  }
  return p as Record<string, unknown>;
}

/** Assemble this tick's observation: poll ground truth + open-escalation status. */
export async function gatherObservation(mirror: Mirror, deps: Pick<ExecDeps, 'lt' | 'client'>): Promise<TwinObservation> {
  const now = Date.now();
  const poll = mirror.sn ? await deps.client.pollDevice(mirror.sn) : null;
  const escalations: Record<string, EscalationObservation> = {};
  for (const kind of Object.keys(mirror.openEscalations) as EscalationKind[]) {
    const id = mirror.openEscalations[kind];
    if (!id) continue;
    const res = await deps.lt.escalations.get({ id });
    if (res.status !== 200 || !res.data) {
      escalations[id] = { status: 'cancelled' }; // 404 → the row is gone; treat as cancelled
      continue;
    }
    const e = res.data;
    escalations[id] = { status: e.status, resolverPayload: parsePayload(e.resolver_payload) };
  }
  return { now, poll, escalations };
}

/** Perform every action, patching created escalation ids back into the mirror ledger. */
export async function executeActions(mirror: Mirror, actions: ReconcileAction[], deps: ExecDeps): Promise<void> {
  for (const a of actions) {
    if (a.type === 'issueCommand') {
      await issueCommand(mirror, a, deps.client);
    } else if (a.type === 'createEscalation') {
      // The form is NOT stamped on the row — it is the target role's versioned
      // form_schema (declared on the role), which the dashboard resolves.
      // Standalone rows — the twin observes their status by POLLING, not via a
      // durable condition wait. Deliberately NO workflow linkage
      // (workflow_id/task_queue/workflow_type): the twin's workflow_id points at
      // the LIVE twin, and linkage would make the resolve attempt a workflow
      // re-entry (a duplicate-job rerun). Association is via metadata.printerId.
      const res = await deps.lt.escalations.create({
        type: TWIN_WORKFLOWS.TWIN,
        subtype: a.spec.subtype,
        role: a.spec.role,
        description: a.spec.description,
        priority: a.spec.priority,
        metadata: a.spec.metadata,
        envelope: JSON.stringify({ printerId: mirror.printerId }),
      });
      if (res.status === 201 && res.data?.id) mirror.openEscalations[a.kind] = res.data.id;
    } else if (a.type === 'resolveEscalation') {
      await deps.lt.escalations.resolve({ id: a.id, resolverPayload: a.payload }).catch(() => {
        /* already terminal — fine */
      });
    } else if (a.type === 'reportBroker') {
      const report =
        deps.reportOutcome ??
        ((i: any) => reportPrintOutcome({ ...i, operatorId: deps.operatorId }).then(() => undefined));
      await report({
        callbackKey: a.callbackKey,
        outcome: a.outcome,
        printerId: mirror.printerId,
        jobId: a.job.jobId,
        orderId: a.job.orderId,
        unitIndex: a.job.unitIndex,
      });
    }
  }
}

async function issueCommand(mirror: Mirror, a: Extract<ReconcileAction, { type: 'issueCommand' }>, client: BambuClient): Promise<void> {
  switch (a.command) {
    case 'bind':
      await client.bind(a.sn, mirror.model || mirror.registration?.model);
      break;
    case 'unbind':
      await client.unbind(a.sn);
      break;
    case 'print':
      if (a.job) await client.uploadAndPrint(a.sn, a.job);
      break;
    case 'stop':
    case 'pause':
    case 'resume':
    case 'bed_clean':
      await client.opt(a.sn, a.command);
      break;
  }
}
