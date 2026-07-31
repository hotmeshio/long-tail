/**
 * Transition Chain — reference workflow for the x-lt-transition hand-off.
 *
 * A three-step onboarding wizard. Step 1 is open to the pool; whoever resolves
 * it becomes the owner (identity via the reserved $resolution key). Steps 2 and
 * 3 are BORN ASSIGNED to that owner in one atomic commit
 * (`conditionLT({ assignee, durationMinutes, parentId })`, HotMesh 0.27.0) and
 * parented to the step the owner just submitted. The dashboard hands the owner
 * straight from one step to the next, so the whole thing feels like a single
 * multi-page form — zero queue navigation.
 *
 * `parentId` is the correlation key: it equals the escalation the owner is on
 * when they submit, so the born-assigned `claimed` event routes them precisely
 * to their next step and nothing else can.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, EscalationResolution } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import {
  TXN_STEP1_ROLE,
  TXN_STEP2_ROLE,
  TXN_STEP3_ROLE,
  TXN_SCHEMA_VERSION,
  type TxnStep1V1,
  type TxnStep2V1,
  type TxnStep3V1,
} from './forms';

// Hold the born-assigned steps as a hard claim so the follow-on stays with the
// owner (an assignee with no window is a soft hint others could claim).
const HOLD_MINUTES = 30;

/** A placeholder email derived from the account name, so step 1's seeded
 *  defaults are valid and can be submitted straight from the list. */
function emailForAccount(account: string): string {
  const slug = account.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '');
  return `${slug || 'account'}@example.com`;
}

export interface TransitionChainEnvelopeData {
  account?: string;
}

export async function transitionChain(envelope: LTEnvelope): Promise<any> {
  const ctx = Durable.workflow.workflowInfo();
  const { account = 'New account' } = (envelope.data ?? {}) as TransitionChainEnvelopeData;

  // ── Step 1: Account — open to the pool ────────────────────────────────────
  const step1 = await conditionLT<TxnStep1V1 & { $resolution?: EscalationResolution }>(
    `txn-step-1-${ctx.workflowId}`,
    {
      role: TXN_STEP1_ROLE,
      type: 'onboarding',
      subtype: 'account',
      priority: 2,
      description: `Onboarding — ${account} · Step 1 of 3`,
      workflowType: 'transitionChain',
      // Seeded with valid defaults so the account can be started straight from
      // the list (x-lt-row-action submitOnClaim); a person opening the detail
      // still edits them before submitting.
      envelope: { source: 'transition-chain', formDefaults: { full_name: account, email: emailForAccount(account) } },
      metadata: { account },
      schemaVersion: TXN_SCHEMA_VERSION,
    },
  );
  if (!step1) return { type: 'return' as const, data: { stage: 'account', completed: false } };

  // Whoever resolved step 1 owns the chain; step 1's id parents step 2.
  const owner = step1.$resolution?.resolvedBy;
  const parent1 = step1.$resolution?.escalationId;

  // ── Step 2: Preferences — born assigned to the owner ──────────────────────
  const step2 = await conditionLT<TxnStep2V1 & { $resolution?: EscalationResolution }>(
    `txn-step-2-${ctx.workflowId}`,
    {
      role: TXN_STEP2_ROLE,
      type: 'onboarding',
      subtype: 'preferences',
      priority: 2,
      description: `Onboarding — ${account} · Step 2 of 3`,
      workflowType: 'transitionChain',
      envelope: { source: 'transition-chain', formDefaults: { plan: '', seats: 1 } },
      metadata: { account },
      assignee: owner,
      durationMinutes: HOLD_MINUTES,
      parentId: parent1,
      schemaVersion: TXN_SCHEMA_VERSION,
    },
  );
  if (!step2) return { type: 'return' as const, data: { stage: 'preferences', completed: false } };

  const parent2 = step2.$resolution?.escalationId;

  // ── Step 3: Review & confirm — born assigned; terminal (no hand-off) ──────
  const step3 = await conditionLT<TxnStep3V1>(`txn-step-3-${ctx.workflowId}`, {
    role: TXN_STEP3_ROLE,
    type: 'onboarding',
    subtype: 'confirm',
    priority: 2,
    description: `Onboarding — ${account} · Step 3 of 3`,
    workflowType: 'transitionChain',
    envelope: { source: 'transition-chain', formDefaults: { confirmed: false, notes: '' } },
    metadata: { account },
    assignee: owner,
    durationMinutes: HOLD_MINUTES,
    parentId: parent2,
    schemaVersion: TXN_SCHEMA_VERSION,
  });
  if (!step3) return { type: 'return' as const, data: { stage: 'confirm', completed: false } };

  return {
    type: 'return' as const,
    data: { account, owner: owner ?? null, step1, step2, step3, completed: true },
  };
}
