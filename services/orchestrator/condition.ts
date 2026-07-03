import { Durable } from '@hotmeshio/hotmesh';
import type { Types } from '@hotmeshio/hotmesh';

import { ESCALATION_METADATA_KEYS } from '../../types/escalation';
import * as interceptorActivities from '../interceptor/activities';

type ActivitiesType = typeof interceptorActivities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * HotMesh's escalation config plus long-tail sugar. `schemaVersion` pins the
 * role-schema version (lt_role_schemas) the resolver form should render; it is
 * folded into `metadata.schema_version` before the config reaches the engine,
 * so the pin rides the row's GIN-indexed metadata like any other facet. Omit
 * it and the resolver UI simply uses the role's latest schema.
 */
export type ConditionEscalationConfig = Types.ConditionQueueConfig & {
  schemaVersion?: number;
};

/** Fold the schemaVersion sugar into metadata; pass everything else through. */
function toEngineConfig(
  escalation?: ConditionEscalationConfig,
): Types.ConditionQueueConfig | undefined {
  if (!escalation || escalation.schemaVersion == null) return escalation;
  const { schemaVersion, ...config } = escalation;
  return {
    ...config,
    metadata: {
      ...config.metadata,
      [ESCALATION_METADATA_KEYS.SCHEMA_VERSION]: schemaVersion,
    },
  };
}

/**
 * Wait for a signal and resolve the associated escalation automatically.
 *
 * Two ways to call it:
 *
 * **Efficient (atomic) — pass an escalation config.** The escalation row is
 * written inside this workflow's Leg1 checkpoint (one commit, crash-safe — no
 * separate create activity, no enrich). `signal_key` is the signal id, so the
 * dashboard resolve endpoint (Path 0), `resolveEscalationBySignalKey`, and any
 * webhook resume the SAME job in place. `system.escalation.{id}.created` fires
 * from the engine automatically.
 *
 * ```typescript
 * const decision = await conditionLT<{ approved: boolean }>(signalId, {
 *   role: 'reviewer',
 *   type: 'orderPipeline',
 *   subtype: stationName,
 *   priority: 2,
 *   description: instructions,
 *   metadata: { orderId, station: stationName },
 *   envelope: { instructions },
 * });
 * ```
 *
 * **Pin the role schema version (optional).** Role form/metadata schemas are
 * versioned (lt_role_schemas). Set `schemaVersion` when this wait depends on a
 * specific shape — e.g. a review form that gained a field the workflow expects
 * back. The resolver UI renders exactly that version for this escalation;
 * without it, the role's latest schema always applies.
 *
 * ```typescript
 * const decision = await conditionLT<{ approved: boolean; lotNumber: string }>(signalId, {
 *   role: 'reviewer',
 *   description: instructions,
 *   schemaVersion: 3,                     // render role schema v3 for this row
 * });
 * ```
 *
 * **With an SLA (hotmesh 0.25.1+) — add `timeout` to the config.** The same
 * single wait arms a resume timer alongside the escalation row: when the timer
 * fires first, this helper returns `false`, the row transitions to
 * `status='expired'` (engine-side, atomically), and a late resolve fails as
 * `already-expired`. A signal that arrives first resolves normally and the
 * timer is inert.
 *
 * ```typescript
 * const decision = await conditionLT<{ approved: boolean }>(signalId, {
 *   role: 'reviewer',
 *   description: instructions,
 *   metadata: { orderId },
 *   timeout: '24h',                       // SLA deadline for this worklist row
 * });
 * if (decision === false) {
 *   // deadline passed — the row is already status='expired'; branch to the
 *   // fallback path (auto-reject, escalate the order, notify, …)
 * }
 * ```
 *
 * **Legacy (two-step) — no config.** Create the escalation first (e.g. via
 * `ltCreateEscalation`) with `signal_id`/`signal_routing` metadata, then wait.
 * On resume the signal payload carries an injected `$escalation_id`; this helper
 * strips it, resolves the escalation as a durable activity, and returns the
 * clean resolver payload. If no `$escalation_id` is present (efficient path, or
 * a manual signal), the payload is returned as-is — the escalation was already
 * resolved server-side.
 *
 * ```typescript
 * await activities.ltCreateEscalation({ type: 'approval', role: 'reviewer', metadata: { signal_id: signalId } });
 * const decision = await conditionLT<{ approved: boolean }>(signalId);
 * ```
 */
export async function conditionLT<T = Record<string, any>>(
  signalId: string,
  escalation?: ConditionEscalationConfig,
): Promise<T | false | null> {
  const raw = await Durable.workflow.condition<T & { $escalation_id?: string }>(
    signalId,
    toEngineConfig(escalation),
  ) as (T & { $escalation_id?: string }) | false | null;

  // false = timeout, null = escalation was cancelled — propagate both as-is
  if (raw === null || raw === false) return raw;

  const escalationId = raw.$escalation_id;
  if (escalationId) {
    // Resolve the escalation as a durable activity (crash-safe)
    const { ltResolveEscalation } = Durable.workflow.proxyActivities<ActivitiesType>({
      activities: interceptorActivities,
      taskQueue: LT_ACTIVITY_QUEUE,
      retry: { maximumAttempts: 3 },
    });

    // Strip the injected control keys ($escalation_id, $escalation_metadata) before the
    // payload is returned to the caller. The outcome patch ($escalation_metadata, set by
    // the resolve orchestrator's signal paths) rides INTO the single atomic resolve below
    // so it merges in the same guarded UPDATE — never a separate write.
    const { $escalation_id: _id, $escalation_metadata: metadata, ...resolverPayload } = raw as
      typeof raw & { $escalation_metadata?: Record<string, any> };
    await ltResolveEscalation({
      escalationId,
      resolverPayload: resolverPayload as Record<string, any>,
      metadata: metadata as Record<string, any> | undefined,
    });

    return resolverPayload as unknown as T;
  }

  return raw as T;
}
