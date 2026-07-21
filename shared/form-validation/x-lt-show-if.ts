/**
 * x-lt-showIf — conditional field visibility. A form_schema property may
 * declare `x-lt-showIf: "domain.path"` to show the field only when the value
 * at that path is present and truthy. Prefix `!` to invert: show when absent
 * or falsy.
 *
 * Equality forms compare the resolved value's string form:
 *   "domain.path=VALUE"   — show when String(value) equals VALUE
 *   "domain.path!=VALUE"  — show when it does not
 * An absent value compares as the empty string, so `=X` is false and `!=X` is
 * true when the path is missing. VALUE is the raw remainder after the operator
 * (trimmed; no quoting). The truthy/! forms are unchanged.
 *
 * Domains follow the same `domain.path` convention as x-lt-help tokens:
 *   metadata   — the escalation row's metadata dict
 *   payload    — the escalation context payload (escalation_payload)
 *   envelope   — the workflow-sent input envelope
 *   escalation — top-level escalation row fields
 *   resolver   — the submitted resolver payload
 *
 * A missing or non-string condition always shows the field (opt-in, safe default).
 */
import { getDeep } from './x-lt-bind';
import { HELP_DOMAINS, type HelpTokenContext } from './x-lt-help';

export type ShowIfContext = HelpTokenContext;

function isTruthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && value !== false && value !== 0;
}

/** The value's comparable string form; absent compares as the empty string. */
function asComparable(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function resolvePath(expr: string, ctx: ShowIfContext): { known: boolean; value: unknown } {
  const dot = expr.indexOf('.');
  const domain = (dot === -1 ? expr : expr.slice(0, dot)) as (typeof HELP_DOMAINS)[number];
  if (!(HELP_DOMAINS as readonly string[]).includes(domain)) return { known: false, value: undefined };
  const root = ctx[domain];
  if (dot === -1) return { known: true, value: root };
  try {
    return { known: true, value: getDeep(root, expr.slice(dot + 1)) };
  } catch {
    return { known: true, value: undefined };
  }
}

/**
 * Evaluates an x-lt-showIf condition. Returns true when the field should be
 * shown. Returns true when condition is absent, non-string, or context is null.
 */
export function evaluateShowIf(condition: unknown, ctx: ShowIfContext | null | undefined): boolean {
  if (typeof condition !== 'string' || condition.length === 0) return true;
  if (!ctx) return true;
  const negate = condition.startsWith('!');
  const expr = negate ? condition.slice(1) : condition;

  // Equality forms — `!=` first so it never parses as `=` with a `!` in the path.
  const neqAt = expr.indexOf('!=');
  const eqAt = expr.indexOf('=');
  if (neqAt !== -1 || (eqAt !== -1 && eqAt !== neqAt + 1)) {
    const isNeq = neqAt !== -1 && (eqAt === -1 || neqAt < eqAt);
    const opAt = isNeq ? neqAt : eqAt;
    const path = expr.slice(0, opAt).trim();
    const expected = expr.slice(opAt + (isNeq ? 2 : 1)).trim();
    const { known, value } = resolvePath(path, ctx);
    if (!known) return true; // unknown domain — safe default, same as truthy form
    const matches = asComparable(value) === expected;
    const result = isNeq ? !matches : matches;
    return negate ? !result : result;
  }

  const { known, value } = resolvePath(expr, ctx);
  if (!known) return true;
  return negate ? !isTruthy(value) : isTruthy(value);
}
