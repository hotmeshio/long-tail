import * as escalationService from '../../services/escalation';
import type {
  AccumulateItemServiceOutcome,
  AccumulateReciprocal,
  RemoveItemServiceOutcome,
} from '../../services/escalation/accumulate';
import { checkResolverPayload } from '../../services/escalation/resolver-validation';
import { getEnforcingRoles } from '../../services/role/enforcement-cache';
import { ESCALATION_ACCUMULATE_KEYS, ESCALATION_BATCH_KEYS } from '../../types/escalation';
import type { AccumulatedItem, LTEscalationRecord } from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

import { assertReadAccess, assertWriteAccess, getEscalationWriteScope } from './helpers';
import { validationFailure, redactPasswords, resolverIdentity } from './resolve';
import { restrictScopeRoles } from './metadata';

/** Names the second row of a reciprocal add or removal. Exactly one selector. */
export interface ReciprocalInput {
  id?: string;
  signalKey?: string;
  key?: string;
  value?: string;
  payload?: Record<string, any>;
}

export interface AccumulateItemInput {
  itemKey: string;
  /** Stored on the entry and delivered inside `$accumulated`. Validates
   * against the container's versioned role form when present. */
  payload?: Record<string, any>;
  metadata?: Record<string, any>;
  assertClaim?: boolean;
  reciprocal?: ReciprocalInput;
}

function parseEnvelope(escalation: LTEscalationRecord): Record<string, any> {
  try {
    const parsed = JSON.parse(escalation.envelope || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isAccumulator(escalation: LTEscalationRecord): boolean {
  const items = parseEnvelope(escalation)[ESCALATION_ACCUMULATE_KEYS.ITEMS];
  return !!items && typeof items === 'object' && !Array.isArray(items);
}

function isBatch(escalation: LTEscalationRecord): boolean {
  return Array.isArray((escalation.metadata as any)?.[ESCALATION_BATCH_KEYS.PENDING]);
}

function reciprocalSelectorCount(r: ReciprocalInput): number {
  return (r.id ? 1 : 0) + (r.signalKey ? 1 : 0) + (r.key !== undefined ? 1 : 0);
}

/**
 * Locates and RBAC-gates the reciprocal row before the statement. The row
 * must be visible to the caller (404 non-disclosure otherwise) and within
 * their write scope (403 by id; 404 for the ingress selectors). Returns the
 * selector the service forwards, resolved to the row's id.
 */
async function gateReciprocal(
  input: ReciprocalInput | undefined,
  auth: LTApiAuth,
): Promise<{ reciprocal?: AccumulateReciprocal } | { error: LTApiResult }> {
  if (!input) return {};
  if (reciprocalSelectorCount(input) !== 1) {
    return { error: { status: 400, error: 'reciprocal requires exactly one of id, signalKey, or key/value' } };
  }
  let row: LTEscalationRecord | null = null;
  if (input.id) {
    row = await escalationService.getEscalation(input.id);
  } else if (input.signalKey) {
    row = await escalationService.getEscalationBySignalKey(input.signalKey);
  } else {
    const writeScope = await getEscalationWriteScope(auth.userId);
    const found = await escalationService.findByMetadata(
      input.key!, String(input.value), 'pending', 1, 0,
      writeScope.global ? undefined : { allRoles: writeScope.allRoles, meUserId: auth.userId },
    );
    row = found.escalations[0] ?? null;
  }
  if (!row) return { error: { status: 404, error: 'Reciprocal escalation not found' } };
  if (input.id) {
    if (await assertReadAccess(auth.userId, row)) {
      return { error: { status: 404, error: 'Reciprocal escalation not found' } };
    }
    const denied = await assertWriteAccess(auth.userId, row);
    if (denied) return { error: { ...denied, error: `Reciprocal: ${denied.error}` } };
  } else if (await assertWriteAccess(auth.userId, row)) {
    return { error: { status: 404, error: 'Reciprocal escalation not found' } };
  }
  return { reciprocal: { id: row.id, payload: input.payload } };
}

/** Validates the item payload against the container's versioned role form. */
async function gatePayload(
  escalation: LTEscalationRecord,
  payload: Record<string, any> | undefined,
  userId: string,
): Promise<{ payload?: Record<string, any> } | { error: LTApiResult }> {
  if (payload === undefined) return {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: { status: 400, error: 'payload must be an object' } };
  }
  const violation = await checkResolverPayload(escalation, payload, undefined, userId);
  if (violation) return { error: validationFailure(violation) };
  return { payload: await redactPasswords(payload, (escalation.metadata as any)?.form_schema) };
}

/**
 * Add ONE item to an accumulator escalation (a `conditional` wait declared
 * with `accumulate: {...}`). Interim adds are cheap atomic row appends: the
 * row stays pending and `count`/`remaining` report progress. An add that
 * reaches `max` completes the escalation: the row resolves and the waiting
 * workflow wakes with the ordered collection, in the same statement.
 *
 * With `reciprocal`, a second accumulator row is written in that same
 * statement or not at all: it holds this container's id as its item key and
 * each entry points at the other row. The reciprocal is RBAC-gated here
 * before the statement runs.
 *
 * Claim semantics match batch: claim-agnostic by default (a container
 * collects contributions from many hands); `assertClaim: true` requires the
 * caller's own live claim, asserted atomically inside the SDK statement.
 */
export async function accumulateItem(
  input: { id: string } & AccumulateItemInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, itemKey, metadata } = input;
    if (!itemKey) return { status: 400, error: 'itemKey is required' };

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (escalation.status === 'cancelled') return { status: 409, error: 'Escalation is cancelled' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for accumulation' };
    if (!isAccumulator(escalation)) return { status: 400, error: 'Escalation is not an accumulator' };

    if (await assertReadAccess(auth.userId, escalation)) {
      return { status: 404, error: 'Escalation not found' };
    }
    const denied = await assertWriteAccess(auth.userId, escalation);
    if (denied) return denied;

    const reciprocal = await gateReciprocal(input.reciprocal, auth);
    if ('error' in reciprocal) return reciprocal.error;
    const payload = await gatePayload(escalation, input.payload, auth.userId);
    if ('error' in payload) return payload.error;

    const result = await escalationService.accumulateItem(escalation.id, {
      itemKey,
      payload: payload.payload,
      metadata: { ...metadata, resolved_by: auth.userId },
      actor: auth.userId,
      assertClaim: input.assertClaim ? auth.userId : undefined,
      resolvedBy: await resolverIdentity(auth),
      reciprocal: reciprocal.reciprocal,
    });
    return accumulateOutcomeResult(result, itemKey, escalation.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Add selecting the container by its `signal_key`, the deterministic home
 * signal id the waiting workflow parked on. Mirrors resolve-by-signal-key:
 * claim-agnostic, write-scope gated with 404 non-disclosure.
 */
export async function accumulateItemBySignalKey(
  input: { signalKey: string } & Omit<AccumulateItemInput, 'assertClaim'>,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { signalKey, itemKey, metadata } = input;
    if (!signalKey) return { status: 400, error: 'signalKey is required' };
    if (!itemKey) return { status: 400, error: 'itemKey is required' };

    const escalation = await escalationService.getEscalationBySignalKey(signalKey);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for accumulation' };
    if (!isAccumulator(escalation)) return { status: 400, error: 'Escalation is not an accumulator' };

    const denied = await assertWriteAccess(auth.userId, escalation);
    if (denied) return { status: 404, error: 'Escalation not found' };

    const reciprocal = await gateReciprocal(input.reciprocal, auth);
    if ('error' in reciprocal) return reciprocal.error;
    const payload = await gatePayload(escalation, input.payload, auth.userId);
    if ('error' in payload) return payload.error;

    const result = await escalationService.accumulateItemBySignalKey(signalKey, {
      itemKey,
      payload: payload.payload,
      metadata: { ...metadata, resolved_by: auth.userId },
      actor: auth.userId,
      resolvedBy: await resolverIdentity(auth),
      reciprocal: reciprocal.reciprocal,
    });
    return accumulateOutcomeResult(result, itemKey, escalation.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Add selecting the container by metadata facet, the faceted sibling of
 * {@link accumulateItem}. RBAC folds into the SDK's atomic facet selection
 * as a flat role filter. Schema enforcement is two-phase when enforcing
 * roles exist and a payload is present: the row is picked first, validated
 * against ITS schema, then written by asserted id; a row that went terminal
 * between phases surfaces as a 409.
 */
export async function accumulateItemByMetadata(
  input: { key: string; value: string; restrictRoles?: string[] } & Omit<AccumulateItemInput, 'assertClaim'>,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { key, value, itemKey, metadata } = input;
    if (!key || !value) return { status: 400, error: 'key and value are required' };
    if (!itemKey) return { status: 400, error: 'itemKey is required' };

    const writeScope = await getEscalationWriteScope(auth.userId);
    const allowedRoles = restrictScopeRoles(writeScope.allRoles, writeScope.global, input.restrictRoles);
    const reciprocal = await gateReciprocal(input.reciprocal, auth);
    if ('error' in reciprocal) return reciprocal.error;
    const resolvedBy = await resolverIdentity(auth);
    const outcome = { ...metadata, resolved_by: auth.userId };

    const enforcing = await getEnforcingRoles();
    if (enforcing.size === 0 || input.payload === undefined) {
      const result = await escalationService.accumulateItemByMetadata(key, value, {
        itemKey,
        payload: input.payload,
        metadata: outcome,
        actor: auth.userId,
        resolvedBy,
        roles: allowedRoles ?? undefined,
        reciprocal: reciprocal.reciprocal,
      });
      return accumulateOutcomeResult(result, itemKey, result.escalation?.workflow_id ?? null);
    }

    const found = await escalationService.findByMetadata(
      key, value, 'pending', 1, 0,
      allowedRoles === null ? undefined : { allRoles: allowedRoles, meUserId: auth.userId },
    );
    const row = found.escalations[0];
    if (!row) return { status: 404, error: 'No pending escalation found for this metadata' };
    if (!isAccumulator(row)) return { status: 400, error: 'Escalation is not an accumulator' };
    const payload = await gatePayload(row, input.payload, auth.userId);
    if ('error' in payload) return payload.error;

    const result = await escalationService.accumulateItem(row.id, {
      itemKey,
      payload: payload.payload,
      metadata: outcome,
      actor: auth.userId,
      resolvedBy,
      reciprocal: reciprocal.reciprocal,
    });
    if (result.outcome === 'not-found') {
      return { status: 409, error: 'A concurrent change is already in progress for this escalation' };
    }
    return accumulateOutcomeResult(result, itemKey, row.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export interface RemoveItemInput {
  itemKey: string;
  reciprocal?: Omit<ReciprocalInput, 'payload'>;
}

/**
 * Remove ONE held item from a pending accumulator escalation, one guarded
 * statement, no wake. With `reciprocal`, the container's id leaves that row
 * in the same statement or neither row changes.
 */
export async function removeItem(
  input: { id: string } & RemoveItemInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, itemKey } = input;
    if (!itemKey) return { status: 400, error: 'itemKey is required' };
    const escalation = await escalationService.getEscalation(id);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for accumulation' };
    if (!isAccumulator(escalation)) return { status: 400, error: 'Escalation is not an accumulator' };
    if (await assertReadAccess(auth.userId, escalation)) {
      return { status: 404, error: 'Escalation not found' };
    }
    const denied = await assertWriteAccess(auth.userId, escalation);
    if (denied) return denied;
    const reciprocal = await gateReciprocal(input.reciprocal, auth);
    if ('error' in reciprocal) return reciprocal.error;

    const result = await escalationService.removeAccumulatedItem(escalation.id, {
      itemKey, actor: auth.userId, reciprocal: reciprocal.reciprocal,
    });
    return removeOutcomeResult(result, itemKey);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function removeItemBySignalKey(
  input: { signalKey: string } & RemoveItemInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { signalKey, itemKey } = input;
    if (!signalKey) return { status: 400, error: 'signalKey is required' };
    if (!itemKey) return { status: 400, error: 'itemKey is required' };
    const escalation = await escalationService.getEscalationBySignalKey(signalKey);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for accumulation' };
    if (!isAccumulator(escalation)) return { status: 400, error: 'Escalation is not an accumulator' };
    if (await assertWriteAccess(auth.userId, escalation)) {
      return { status: 404, error: 'Escalation not found' };
    }
    const reciprocal = await gateReciprocal(input.reciprocal, auth);
    if ('error' in reciprocal) return reciprocal.error;
    const result = await escalationService.removeAccumulatedItemBySignalKey(signalKey, {
      itemKey, actor: auth.userId, reciprocal: reciprocal.reciprocal,
    });
    return removeOutcomeResult(result, itemKey);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function removeItemByMetadata(
  input: { key: string; value: string; restrictRoles?: string[] } & RemoveItemInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { key, value, itemKey } = input;
    if (!key || !value) return { status: 400, error: 'key and value are required' };
    if (!itemKey) return { status: 400, error: 'itemKey is required' };
    const writeScope = await getEscalationWriteScope(auth.userId);
    const allowedRoles = restrictScopeRoles(writeScope.allRoles, writeScope.global, input.restrictRoles);
    const reciprocal = await gateReciprocal(input.reciprocal, auth);
    if ('error' in reciprocal) return reciprocal.error;
    const result = await escalationService.removeAccumulatedItemByMetadata(key, value, {
      itemKey, actor: auth.userId, roles: allowedRoles ?? undefined, reciprocal: reciprocal.reciprocal,
    });
    return removeOutcomeResult(result, itemKey);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export interface EscalationItemsView {
  escalationId: string;
  kind: 'accumulate' | 'batch';
  status: LTEscalationRecord['status'];
  count: number;
  /** The count trigger (accumulate) or the declared size (batch); null when unbounded. */
  max: number | null;
  items: AccumulatedItem[];
  /** Batch only: declared keys still awaiting submission. */
  pending?: string[];
}

/** The normalized ordered item list of an accumulator or batch row. */
export function itemsView(escalation: LTEscalationRecord): EscalationItemsView | null {
  const envelope = parseEnvelope(escalation);
  const metadata = (escalation.metadata ?? {}) as Record<string, any>;
  if (isAccumulator(escalation)) {
    const store = envelope[ESCALATION_ACCUMULATE_KEYS.ITEMS] as Record<string, any>;
    const items: AccumulatedItem[] = Object.entries(store)
      .map(([itemKey, entry]) => ({ itemKey, ...(entry as Record<string, any>) } as AccumulatedItem))
      .sort((a, b) => a.at.localeCompare(b.at) || a.itemKey.localeCompare(b.itemKey));
    const max = metadata[ESCALATION_ACCUMULATE_KEYS.MAX];
    return {
      escalationId: escalation.id,
      kind: 'accumulate',
      status: escalation.status,
      count: items.length,
      max: typeof max === 'number' ? max : null,
      items,
    };
  }
  if (isBatch(escalation)) {
    const store = (envelope[ESCALATION_BATCH_KEYS.ITEMS] ?? {}) as Record<string, any>;
    const filledAt = (envelope[ESCALATION_BATCH_KEYS.FILLED_AT] ?? {}) as Record<string, string>;
    const keys = (metadata[ESCALATION_BATCH_KEYS.KEYS] ?? []) as string[];
    const items: AccumulatedItem[] = Object.entries(store)
      .map(([itemKey, payload]) => ({ itemKey, payload: payload as Record<string, unknown>, at: filledAt[itemKey] ?? '' }))
      .sort((a, b) => a.at.localeCompare(b.at) || a.itemKey.localeCompare(b.itemKey));
    return {
      escalationId: escalation.id,
      kind: 'batch',
      status: escalation.status,
      count: items.length,
      max: keys.length,
      items,
      pending: metadata[ESCALATION_BATCH_KEYS.PENDING] ?? [],
    };
  }
  return null;
}

/** GET the held items of an accumulator or batch row, in arrival order. Read access; 404 non-disclosure. */
export async function getEscalationItems(
  input: { id: string },
  auth: LTApiAuth,
): Promise<LTApiResult<EscalationItemsView>> {
  try {
    const escalation = await escalationService.getEscalation(input.id);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (await assertReadAccess(auth.userId, escalation)) {
      return { status: 404, error: 'Escalation not found' };
    }
    const view = itemsView(escalation);
    if (!view) return { status: 400, error: 'Escalation holds no items' };
    return { status: 200, data: view };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

function sideData(side: { outcome: string; count: number; remaining: number | null; escalation: LTEscalationRecord }) {
  return {
    outcome: side.outcome,
    count: side.count,
    remaining: side.remaining,
    escalationId: side.escalation.id,
    signaled: side.outcome === 'completed' && !!side.escalation.signal_key,
  };
}

/** Maps the SDK accumulate outcome vocabulary onto HTTP results. */
function accumulateOutcomeResult(
  result: AccumulateItemServiceOutcome,
  itemKey: string,
  workflowId: string | null,
): LTApiResult {
  const reciprocal = result.reciprocal ? { reciprocal: sideData(result.reciprocal) } : {};
  switch (result.outcome) {
    case 'completed':
      return {
        status: 200,
        data: {
          outcome: 'completed',
          count: result.count,
          remaining: 0,
          signaled: !!result.escalation?.signal_key,
          escalationId: result.escalation?.id,
          workflowId,
          ...reciprocal,
        },
      };
    case 'accepted':
      return {
        status: 200,
        data: {
          outcome: 'accepted',
          count: result.count,
          remaining: result.remaining,
          escalationId: result.escalation?.id,
          ...reciprocal,
        },
      };
    case 'duplicate-item':
      return { status: 409, error: 'Item already held', data: { error: 'Item already held', itemKey } };
    case 'full':
      return { status: 409, error: 'Accumulator is full', data: { error: 'Accumulator is full', itemKey } };
    case 'claimed-by-other':
      return { status: 409, error: 'Escalation is claimed by another user' };
    case 'claim-expired':
      return { status: 409, error: 'Your claim has expired; re-claim this escalation to add to it' };
    case 'not-found':
      return { status: 404, error: 'Escalation not found' };
    case 'not-accumulator':
      return { status: 400, error: 'Escalation is not an accumulator' };
    case 'reciprocal-not-found':
      return { status: 404, error: 'Reciprocal escalation not found' };
    case 'reciprocal-not-accumulator':
      return { status: 400, error: 'Reciprocal escalation is not an accumulator' };
    case 'reciprocal-duplicate':
      return { status: 409, error: 'Reciprocal escalation already holds this container', data: { error: 'Reciprocal escalation already holds this container', outcome: result.outcome } };
    case 'reciprocal-full':
      return { status: 409, error: 'Reciprocal accumulator is full', data: { error: 'Reciprocal accumulator is full', outcome: result.outcome } };
    case 'reciprocal-terminal':
      return { status: 409, error: 'Reciprocal escalation is no longer pending', data: { error: 'Reciprocal escalation is no longer pending', outcome: result.outcome } };
    default:
      return { status: 409, error: 'Escalation not available for accumulation' };
  }
}

function removeOutcomeResult(result: RemoveItemServiceOutcome, itemKey: string): LTApiResult {
  switch (result.outcome) {
    case 'removed':
      return {
        status: 200,
        data: {
          outcome: 'removed',
          count: result.count,
          escalationId: result.escalation?.id,
          ...(result.reciprocal
            ? { reciprocal: { count: result.reciprocal.count, escalationId: result.reciprocal.escalation.id } }
            : {}),
        },
      };
    case 'item-absent':
      return { status: 404, error: 'Item not held by this escalation', data: { error: 'Item not held by this escalation', itemKey } };
    case 'not-found':
      return { status: 404, error: 'Escalation not found' };
    case 'not-accumulator':
      return { status: 400, error: 'Escalation is not an accumulator' };
    case 'reciprocal-not-found':
      return { status: 404, error: 'Reciprocal escalation not found' };
    case 'reciprocal-not-accumulator':
      return { status: 400, error: 'Reciprocal escalation is not an accumulator' };
    case 'reciprocal-absent':
      return { status: 404, error: 'Reciprocal escalation does not hold this container', data: { error: 'Reciprocal escalation does not hold this container', outcome: result.outcome } };
    case 'reciprocal-terminal':
      return { status: 409, error: 'Reciprocal escalation is no longer pending', data: { error: 'Reciprocal escalation is no longer pending', outcome: result.outcome } };
    default:
      return { status: 409, error: 'Escalation not available for accumulation' };
  }
}
