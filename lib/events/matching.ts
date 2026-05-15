/**
 * Match a dot-delimited subject against a pattern with NATS-style wildcards.
 *
 * - `*` matches exactly one token
 * - `>` matches one or more remaining tokens (must be last segment)
 *
 * Examples:
 * - `task.created` matches `task.*`
 * - `app.epic.apis.createorder.error` matches `app.epic.apis.*.error`
 * - `app.epic.apis.createorder.error` matches `app.epic.>`
 * - `app.epic.apis.createorder.error` does NOT match `app.vendor.>`
 */
export function subjectMatchesPattern(subject: string, pattern: string): boolean {
  if (pattern === '*') return true;

  const subjectTokens = subject.split('.');
  const patternTokens = pattern.split('.');

  for (let i = 0; i < patternTokens.length; i++) {
    const pt = patternTokens[i];

    if (pt === '>') return true;
    if (i >= subjectTokens.length) return false;
    if (pt !== '*' && pt !== subjectTokens[i]) return false;
  }

  return subjectTokens.length === patternTokens.length;
}
