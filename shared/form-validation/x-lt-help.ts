/**
 * x-lt-help — the form's guidance content, rendered in the side panel beside
 * the resolve form. A form_schema may declare schema-level `x-lt-help`: a
 * markdown string whose `{{domain.path}}` tokens interpolate values from the
 * escalation surface, so help text can reference the live record:
 *
 *   {{escalation.role}}                        — any column on the escalation row
 *   {{metadata.schema_version}}                — the row's metadata dict
 *   {{envelope.formDefaults.customer.name}}    — the workflow-sent input envelope
 *   {{payload.category}}                       — the escalation context payload
 *   {{resolver.notes}}                         — the submitted resolver payload
 *
 * Paths reuse the x-lt-bind syntax (`a.b[0].c`). A missing value renders as an
 * em dash. `x-lt-context` is accepted as the plain-text fallback source when
 * `x-lt-help` is absent.
 */
import { getDeep } from './x-lt-bind';

/** The token domains a help template may reference. */
export const HELP_DOMAINS = ['escalation', 'metadata', 'envelope', 'payload', 'resolver'] as const;
export type HelpDomain = (typeof HELP_DOMAINS)[number];

export type HelpTokenContext = Partial<Record<HelpDomain, Record<string, unknown> | null>>;

const TOKEN_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MISSING_VALUE = '—';

function formatTokenValue(value: unknown): string {
  if (value === undefined || value === null) return MISSING_VALUE;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return MISSING_VALUE;
  }
}

/** Replace every `{{domain.path}}` token with its value from the context. */
export function interpolateHelp(template: string, ctx: HelpTokenContext): string {
  return template.replace(TOKEN_PATTERN, (_match, rawPath: string) => {
    const dot = rawPath.indexOf('.');
    const domain = (dot === -1 ? rawPath : rawPath.slice(0, dot)) as HelpDomain;
    if (!HELP_DOMAINS.includes(domain)) return MISSING_VALUE;
    const root = ctx[domain];
    if (dot === -1) return formatTokenValue(root);
    try {
      return formatTokenValue(getDeep(root, rawPath.slice(dot + 1)));
    } catch {
      return MISSING_VALUE;
    }
  });
}

/** The schema's help source: `x-lt-help` first, `x-lt-context` as fallback. */
export function resolveHelpSource(schema: Record<string, unknown> | null | undefined): string | null {
  const help = schema?.['x-lt-help'];
  if (typeof help === 'string' && help.trim().length > 0) return help;
  const context = schema?.['x-lt-context'];
  if (typeof context === 'string' && context.trim().length > 0) return context;
  return null;
}

/** The schema's help content, interpolated. Null when the schema declares none. */
export function buildHelpMarkdown(
  schema: Record<string, unknown> | null | undefined,
  ctx: HelpTokenContext,
): string | null {
  const source = resolveHelpSource(schema);
  return source ? interpolateHelp(source, ctx) : null;
}

export interface HelpStateHint {
  isTerminal: boolean;
  status?: string;
  claimed: boolean;
  claimedByMe: boolean;
}

/**
 * State-aware guidance shown when the schema carries no help content — the
 * panel always tells the user what this page expects of them right now.
 */
export function defaultHelpMarkdown({ isTerminal, status, claimed, claimedByMe }: HelpStateHint): string {
  if (isTerminal) {
    return status === 'cancelled'
      ? 'This escalation was cancelled. The record is shown for reference.'
      : 'This escalation has been resolved. The submitted form is shown for reference.';
  }
  if (claimedByMe) return 'You have claimed this escalation. Fill out the form and submit to resolve it.';
  if (claimed) return 'Another user has claimed this escalation. It unlocks if their claim expires or is released.';
  return 'Claim this escalation to enable the form.';
}
