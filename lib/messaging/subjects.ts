/**
 * Subject filters. Subjects are dot-separated tokens; in a filter `*` matches
 * exactly one token and `>` matches one or more trailing tokens.
 */

import type { Subject } from '../../types/messaging';

export function subjectMatches(filter: Subject, subject: Subject): boolean {
  const f = filter.split('.');
  const s = subject.split('.');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '>') return i === f.length - 1 && s.length > i;
    if (i >= s.length) return false;
    if (f[i] !== '*' && f[i] !== s[i]) return false;
  }
  return f.length === s.length;
}

/** Whether `subject` is a valid concrete subject: nonempty tokens, no wildcards or whitespace. */
export function isSubject(subject: string): boolean {
  return !!subject && subject.split('.').every((t) => !!t && !/[\s*>]/.test(t));
}
