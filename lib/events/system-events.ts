import type { Types } from '@hotmeshio/hotmesh';

import type { LTEvent } from '../../types';

import { eventRegistry } from './index';
import { sanitizeSubjectToken } from './matching';
// The ONE wire shape — see escalation-wire.ts for the convention. The engine
// path emits the projection with no extra verb context.
import { projectEscalationRow } from './escalation-wire';

// ---------------------------------------------------------------------------
// SDK system-event bridge (HotMesh 0.22.4 `EventsConfig.publish`).
//
// The SDK fires this hook, inline and post-commit, from the single actor that
// performed a durable transition — most importantly the worker engine that
// writes an escalation row inside a `Durable.workflow.condition(signalId, config)`
// Leg1 transaction (the efficient path). Wiring it on the worker/engine
// construction makes that path emit the same lifecycle events long-tail already
// publishes for the service-mediated path — with no duplication, because the two
// paths are disjoint (service ops use the escalation client and publish inline
// via publishEscalationEvent; condition(config) writes never touch the service).
//
// We map the canonical SystemEvent onto long-tail's LTEvent shape and hand it to
// the existing eventRegistry, which fans out to Socket.IO, NATS, and agent
// callbacks. Exactly-once is guaranteed upstream: the performing actor is the
// only emitter, so a multi-container fleet produces a single event.
// ---------------------------------------------------------------------------

type SystemEvent = Types.SystemEvent;

/** Verb → long-tail event status, matching the manual publishEscalationEvent convention. */
const ESCALATION_STATUS_BY_VERB: Record<string, string> = {
  created: 'pending',
  claimed: 'claimed',
  released: 'released',
  reassigned: 'pending',
  resolved: 'resolved',
  cancelled: 'cancelled',
  // hotmesh 0.25.1: the SLA timer on a condition(config + timeout) wait fired
  // first — the engine transitioned the row and emitted .expired.
  expired: 'expired',
};

/**
 * Translate a HotMesh `SystemEvent` into long-tail's `LTEvent`. Escalation
 * events carry the full committed row in `data`, from which we lift the routing
 * fields; engine/worker lifecycle events pass through with their canonical type.
 */
export function mapSystemEvent(event: SystemEvent): LTEvent {
  const segments = event.type.split('.');
  const domain = segments[1];

  if (domain === 'escalation') {
    const row = (event.data ?? {}) as Record<string, any>;
    const verb = segments[3] ?? '';
    // The SDK forms `system.escalation.{id}.{verb}`; long-tail's canonical
    // subject carries the role as the organizing token. The SDK hands the
    // committed row in `data`; routing fields are lifted from it and the subject
    // is rewritten to `system.escalation.{role}.{id}.{verb}` — the same shape
    // publishEscalationEvent produces for the service-mediated path. The row
    // itself is projected (below) before it rides the wire.
    const role = (row.role as string) || undefined;
    return {
      type: `system.escalation.${sanitizeSubjectToken(role)}.${segments[2]}.${verb}`,
      source: 'sdk',
      role,
      workflowId: (row.workflow_id as string) || event.workflow_id || undefined,
      workflowName: (row.workflow_type as string) || undefined,
      taskQueue: (row.task_queue as string) || undefined,
      escalationId: (row.id as string) || segments[2],
      originId: (row.origin_id as string) || event.origin_id || undefined,
      status: ESCALATION_STATUS_BY_VERB[verb] ?? verb,
      // Assignment provenance rides the SystemEvent envelope, NOT the row (it is
      // not a column). Forward it so a consumer can tell a born-assigned,
      // system-directed hand-off (`claimed` with true) from an interactive claim.
      assignedAtCreation: event.assigned_at_creation,
      // Routing + facets only — never the heavy/sensitive JSON columns. This
      // converges the engine-mediated path toward the thin shape the service
      // path already publishes; a consumer needing the full row fetches it by
      // id through the authenticated read API.
      data: projectEscalationRow(row),
      timestamp: event.ts,
    };
  }

  // Engine / worker lifecycle (system.engine.*, system.worker.*) — additive
  // observability; pass through with the canonical type and metadata payload.
  return {
    type: event.type,
    source: 'sdk',
    workflowId: event.workflow_id || undefined,
    taskQueue: (event.data as Record<string, any>)?.taskQueue || undefined,
    data: event.data,
    timestamp: event.ts,
  };
}

/**
 * The `EventsConfig.publish` hook long-tail wires into every worker/engine it
 * constructs. Fire-and-forget — never throws back into the SDK's committed call.
 */
export function onSystemEvent(event: SystemEvent): void {
  if (!eventRegistry.hasAdapters) return;
  void eventRegistry.publish(mapSystemEvent(event)).catch(() => {});
}

/** The EventsConfig long-tail passes to Durable.Client / Worker.create / HotMesh.init. */
export const systemEventsConfig = { publish: onSystemEvent };
