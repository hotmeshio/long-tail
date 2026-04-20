/**
 * Match a dot-delimited subject against a pattern with `>` (match-rest) and `*` (single-token) wildcards.
 *
 * Used by all event transports (socket.io, NATS) to dispatch events to
 * pattern-based subscribers.
 *
 * Examples:
 * - `lt.events.task.created` matches `lt.events.>`
 * - `lt.events.task.created` matches `lt.events.task.*`
 * - `lt.events.task.created` matches `lt.events.task.created`
 * - `lt.events.task.created` does NOT match `lt.events.escalation.*`
 */
export function subjectMatchesPattern(subject: string, pattern: string): boolean {
  const subjectTokens = subject.split('.');
  const patternTokens = pattern.split('.');

  for (let i = 0; i < patternTokens.length; i++) {
    const pt = patternTokens[i];

    if (pt === '>') return true; // match-rest: everything from here matches
    if (i >= subjectTokens.length) return false; // pattern longer than subject
    if (pt !== '*' && pt !== subjectTokens[i]) return false; // literal mismatch
  }

  // Pattern consumed — subject must also be fully consumed
  return subjectTokens.length === patternTokens.length;
}
