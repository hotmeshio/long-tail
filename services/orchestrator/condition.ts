import { Durable } from '@hotmeshio/hotmesh';
import type { Types } from '@hotmeshio/hotmesh';

import { ESCALATION_METADATA_KEYS, ESCALATION_ENVELOPE_KEYS, assertLookupRefs, type EscalationLookupRef } from '../../types/escalation';
import * as interceptorActivities from '../interceptor/activities';

type ActivitiesType = typeof interceptorActivities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * HotMesh's escalation config plus long-tail sugar. `schemaVersion` pins the
 * role form version (lt_role_schemas) the resolve UI renders; `lookups` pins
 * versioned knowledge editions the form may read (the `lookup.*` context
 * domain — see docs/hitl/lookups.md). Both are compile-time LITERALS the
 * workflow author sets, folded before the config reaches the engine:
 * schemaVersion into the GIN-indexed metadata (a queryable facet), lookups
 * into the unindexed envelope (form plumbing, never a facet). Folding is a
 * pure transform — no query, no activity — so a pinned `conditional` costs
 * exactly what an unpinned one does. Omit `schemaVersion` and the resolve UI
 * renders the role's latest form when the escalation is fetched.
 */
export type ConditionEscalationConfig = Types.ConditionQueueConfig & {
  schemaVersion?: number;
  lookups?: EscalationLookupRef[];
};

/**
 * Fold the sugar before the config reaches the engine: schemaVersion into the
 * GIN-indexed metadata (it is a queryable pin), lookups into the unindexed
 * envelope (they are form plumbing, never a facet). Everything else passes
 * through.
 */
function toEngineConfig(
  escalation?: ConditionEscalationConfig,
): Types.ConditionQueueConfig | undefined {
  if (!escalation || (escalation.schemaVersion == null && escalation.lookups == null)) {
    return escalation;
  }
  const { schemaVersion, lookups, ...config } = escalation;
  if (lookups != null) assertLookupRefs(lookups);
  return {
    ...config,
    ...(schemaVersion != null
      ? { metadata: { ...config.metadata, [ESCALATION_METADATA_KEYS.SCHEMA_VERSION]: schemaVersion } }
      : {}),
    ...(lookups != null
      ? { envelope: { ...config.envelope, [ESCALATION_ENVELOPE_KEYS.LOOKUPS]: lookups } }
      : {}),
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
 * webhook resume the SAME job in place. `system.escalation.{role}.{id}.created` fires
 * from the engine automatically.
 *
 * ```typescript
 * const decision = await conditional<{ approved: boolean }>(signalId, {
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
 * **Pin the role form version — a compile-time literal.** A role's escalation
 * form is versioned (lt_role_schemas); its first form is version 1. Pass the
 * version as a literal, paired with the generic `<T>` payload type, both bumped
 * together when the form evolves. The literal folds into metadata for the same
 * cost as an unpinned wait. Omit it and the resolve UI renders the role's latest
 * form when the escalation is fetched.
 *
 * ```typescript
 * import { INTAKE_SCHEMA_VERSION, type IntakeResolverV1 } from './forms';
 *
 * const decision = await conditional<IntakeResolverV1>(signalId, {
 *   role: INTAKE_ROLE,
 *   description: instructions,
 *   schemaVersion: INTAKE_SCHEMA_VERSION, // the form version this code is written for
 * });
 * ```
 *
 * **Pin versioned knowledge lookups — option lists the form reads.** Each ref
 * names an immutable knowledge edition; the resolve UI fetches them once and
 * the form addresses the content as the `lookup.*` context domain
 * (`x-lt-options: "lookup.materials.items"`). Evolve the list by writing the
 * entry (a new version mints automatically) and repinning the literal here.
 *
 * ```typescript
 * const decision = await conditional<PickerResolverV1>(signalId, {
 *   role: 'catalog-picker',
 *   description: instructions,
 *   lookups: [{ domain: 'catalog', key: 'materials', version: 2 }],
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
 * const decision = await conditional<{ approved: boolean }>(signalId, {
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
 * **Batch accumulation — one wait, N contributions (hotmesh 0.28.0+).** Declare
 * `batch` item keys and the escalation resolves only when every declared item
 * has been submitted via `resolveBatchItem` (HTTP: POST
 * /:id/resolve-batch-item or /resolve-batch-item-by-metadata). Interim
 * submissions are cheap atomic fills — the row stays pending,
 * `metadata.batch_pending`/`batch_count` track progress as queryable facets,
 * and payloads accumulate in `envelope.batch_items`. The LAST item resolves
 * the row and resumes this wait with the full collection, all in one
 * statement. Each item validates against the SAME versioned role form a
 * single-item resolver gets (`schemaVersion` pins apply per item). Type the
 * generic as the collection:
 *
 * ```typescript
 * const parts = await conditional<Record<'cut' | 'weld' | 'paint', StationResultV1>>(signalId, {
 *   role: 'assembly',
 *   description: instructions,
 *   metadata: { orderId },
 *   batch: ['cut', 'weld', 'paint'],
 *   timeout: '24h',                       // SLA covers the whole collection
 * });
 * if (parts === false) { /* expired — partial items audit on the row *​/ }
 * if (parts === null) { /* cancelled *​/ }
 * ```
 *
 * `timeout`/cancel semantics are unchanged (`false`/`null`); partially filled
 * items persist on the terminal row for audit. A plain resolve on a batch row
 * remains an admin override that resolves the whole row with its payload.
 *
 * **Resolution provenance — the reserved `$resolution` key.** When the resolve
 * carries the resolver's identity (the API layer supplies it for interactive
 * and webhook resolves), the payload delivered here includes
 * `$resolution: { escalationId, resolvedBy, resolvedByEmail? }`. Declare it in
 * the generic to consume it — e.g. assign follow-on work to whoever resolved:
 *
 * ```typescript
 * import type { EscalationResolution } from '@hotmeshio/hotmesh/types';
 *
 * const decision = await conditional<{
 *   approved: boolean;
 *   $resolution?: EscalationResolution;
 * }>(signalId, { role: 'print-operator' });
 * const resolver = decision && decision.$resolution?.resolvedBy;
 * ```
 *
 * `$resolution` never lands in the stored `resolver_payload` audit column —
 * on the legacy path below it is stripped before the durable resolve and
 * re-attached to the returned payload.
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
 * const decision = await conditional<{ approved: boolean }>(signalId);
 * ```
 */
export async function conditional<T = Record<string, any>>(
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

    // Strip the injected control keys ($escalation_id, $escalation_metadata,
    // $resolution) before the payload is stored. The outcome patch
    // ($escalation_metadata, set by the resolve orchestrator's signal paths)
    // rides INTO the single atomic resolve below so it merges in the same
    // guarded UPDATE — never a separate write. $resolution is provenance for
    // the CALLER, not the audit column: it re-attaches to the returned payload.
    const { $escalation_id: _id, $escalation_metadata: metadata, $resolution: resolution, ...resolverPayload } = raw as
      typeof raw & { $escalation_metadata?: Record<string, any>; $resolution?: Record<string, any> };
    await ltResolveEscalation({
      escalationId,
      resolverPayload: resolverPayload as Record<string, any>,
      metadata: metadata as Record<string, any> | undefined,
    });

    return (resolution
      ? { ...resolverPayload, $resolution: resolution }
      : resolverPayload) as unknown as T;
  }

  return raw as T;
}

/** @deprecated Alias of {@link conditional}. */
export const conditionLT = conditional;
