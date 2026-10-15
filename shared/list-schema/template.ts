import { getDeep } from '../form-validation/x-lt-bind';
import { HELP_DOMAINS, interpolateHelp, type HelpDomain, type HelpTokenContext } from '../form-validation/x-lt-help';

const SINGLE_TOKEN = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const ANY_TOKEN = /\{\{\s*[^{}]+?\s*\}\}/;
const MISSING_VALUE = '—';

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** The template domains of one escalation row, JSON-string columns parsed. */
export function rowTemplateContext(row: Record<string, unknown>): HelpTokenContext {
  return {
    escalation: row,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    envelope: parseJsonObject(row.envelope) ?? {},
    payload: parseJsonObject(row.escalation_payload) ?? {},
    resolver: parseJsonObject(row.resolver_payload) ?? {},
  };
}

function readToken(path: string, ctx: HelpTokenContext): unknown {
  const dot = path.indexOf('.');
  const domain = (dot === -1 ? path : path.slice(0, dot)) as HelpDomain;
  if (!HELP_DOMAINS.includes(domain)) return undefined;
  const root = ctx[domain];
  if (dot === -1) return root ?? undefined;
  try {
    return getDeep(root, path.slice(dot + 1));
  } catch {
    return undefined;
  }
}

/**
 * Resolve one facet value. A lone `{{token}}` keeps the value's own JSON type
 * (a numeric facet matches a numeric facet); a mixed template interpolates to
 * a string; a literal passes through. Undefined when a token is missing.
 */
export function resolveTemplateValue(value: unknown, ctx: HelpTokenContext): unknown {
  if (typeof value !== 'string') return value;
  const single = value.match(SINGLE_TOKEN);
  if (single) {
    const raw = readToken(single[1], ctx);
    return raw === null || raw === '' ? undefined : raw;
  }
  if (!ANY_TOKEN.test(value)) return value;
  const text = interpolateHelp(value, ctx);
  return text.includes(MISSING_VALUE) ? undefined : text;
}

/**
 * Resolve a related query's match against a host row: every required facet
 * (null when any is missing), plus each `narrow` facet the row resolves.
 */
export function resolveRelatedFacets(
  facets: Record<string, unknown>,
  ctx: HelpTokenContext,
  narrow?: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(facets)) {
    const resolved = resolveTemplateValue(value, ctx);
    if (resolved === undefined) return null;
    out[key] = resolved;
  }
  for (const [key, value] of Object.entries(narrow ?? {})) {
    const resolved = resolveTemplateValue(value, ctx);
    if (resolved !== undefined) out[key] = resolved;
  }
  return out;
}
