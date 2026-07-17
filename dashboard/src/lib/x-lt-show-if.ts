/**
 * x-lt-showIf — conditional field visibility. A form_schema property may
 * declare `x-lt-showIf: "domain.path"` to show the field only when the value
 * at that path is present and truthy. Prefix `!` to invert: show when absent
 * or falsy.
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

/**
 * Evaluates an x-lt-showIf condition. Returns true when the field should be
 * shown. Returns true when condition is absent, non-string, or context is null.
 */
export function evaluateShowIf(condition: unknown, ctx: ShowIfContext | null | undefined): boolean {
  if (typeof condition !== 'string' || condition.length === 0) return true;
  if (!ctx) return true;
  const negate = condition.startsWith('!');
  const expr = negate ? condition.slice(1) : condition;
  const dot = expr.indexOf('.');
  const domain = (dot === -1 ? expr : expr.slice(0, dot)) as (typeof HELP_DOMAINS)[number];
  if (!(HELP_DOMAINS as readonly string[]).includes(domain)) return true;
  const root = ctx[domain];
  let value: unknown;
  if (dot === -1) {
    value = root;
  } else {
    try {
      value = getDeep(root, expr.slice(dot + 1));
    } catch {
      value = undefined;
    }
  }
  return negate ? !isTruthy(value) : isTruthy(value);
}
