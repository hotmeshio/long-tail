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
/**
 * Make a value safe to embed as ONE token of a dot-delimited subject.
 *
 * Dots would splinter the token into extra subject levels; `*`, `>`, spaces,
 * and other non-token characters would corrupt pattern matching (and are
 * illegal in NATS subjects). Each run of unsafe characters collapses to a
 * single `-`. An empty or missing value yields `none` so the subject always
 * keeps its arity.
 */
export function sanitizeSubjectToken(value: string | null | undefined): string {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'none';
}

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
