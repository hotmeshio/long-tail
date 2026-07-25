import { NATS_SUBJECT_PREFIX } from '../nats/config';

/**
 * Escalation subject patterns. The wire shape is
 * `lt.events.system.escalation.{role}.{id}.{verb}` — role is the organizing
 * token, so pages subscribe to exactly the queue, item, or verb slice they
 * render instead of the whole escalation space.
 */

export type EscalationVerb =
  | 'created' | 'claimed' | 'released' | 'resolved'
  | 'cancelled' | 'reassigned' | 'expired';

/**
 * Mirror of the server's subject-token sanitizer: role values embed in
 * patterns as ONE token, with unsafe character runs collapsed to `-` and
 * empty values mapped to `none`.
 */
export function sanitizeSubjectToken(value: string | null | undefined): string {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'none';
}

/** One escalation pattern: any omitted level widens to a wildcard. */
export function escalationPattern(opts: {
  role?: string | null;
  id?: string;
  verb?: EscalationVerb;
} = {}): string {
  const role = opts.role ? sanitizeSubjectToken(opts.role) : '*';
  const id = opts.id ?? '*';
  const tail = opts.verb ?? '>';
  return `${NATS_SUBJECT_PREFIX}.system.escalation.${role}.${id}.${tail}`;
}

/** One pattern per verb, all scoped to the same (optional) role. */
export function escalationPatterns(opts: {
  role?: string | null;
  verbs: EscalationVerb[];
}): string[] {
  return opts.verbs.map((verb) => escalationPattern({ role: opts.role, verb }));
}
