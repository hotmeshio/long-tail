import type { LTEvent } from '../../types';

/**
 * What a browser receives of an event. Builders receive events whole. Anyone
 * else receives enough to route and refresh: escalation events keep their
 * routing fields, and every other event arrives without `data` and
 * `milestones`. Full records are read through the scoped API, by id.
 *
 * Server-side consumers (agent triggers, callbacks) are unaffected: this view
 * applies only where events leave for a browser.
 */

const ESCALATION_SUBJECT = 'system.escalation.';

/** Escalation event fields a browser needs to route a refresh and follow a claim. */
export const BROWSER_ESCALATION_FIELDS = [
  'id', 'type', 'subtype', 'status', 'priority', 'role',
  'assigned_to', 'assigned_until', 'workflow_id', 'workflow_type',
  'origin_id', 'task_id', 'parent_id', 'resolved_at', 'claimed_at',
  'bulk', 'from_role', 'to_role', 'reassigned_from',
] as const;

export interface BrowserViewer {
  builder: boolean;
}

/** The event as this viewer receives it. */
export function eventForViewer(event: LTEvent, viewer: BrowserViewer): LTEvent {
  if (viewer.builder) return event;
  const { data, milestones: _milestones, ...rest } = event;
  if (typeof event.type === 'string' && event.type.startsWith(ESCALATION_SUBJECT) && data) {
    const kept: Record<string, unknown> = {};
    for (const key of BROWSER_ESCALATION_FIELDS) {
      if (data[key] !== undefined) kept[key] = data[key];
    }
    return { ...rest, data: kept };
  }
  return rest;
}

/**
 * Rewrite one serialized event for a viewer who is not a builder. A payload
 * that is not an event is withheld (null).
 */
export function payloadForViewer(payload: Buffer, viewer: BrowserViewer): Buffer | null {
  if (viewer.builder) return payload;
  let event: unknown;
  try {
    event = JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object' || typeof (event as LTEvent).type !== 'string') return null;
  return Buffer.from(JSON.stringify(eventForViewer(event as LTEvent, viewer)), 'utf8');
}

/** Whether a person is a builder, looked up lazily to keep lib free of an import cycle. */
export async function viewerFor(userId: string | null | undefined): Promise<BrowserViewer> {
  if (!userId) return { builder: false };
  try {
    const { mayBuild } = await import('../../modules/capabilities');
    return { builder: await mayBuild({ userId }) };
  } catch {
    return { builder: false };
  }
}
