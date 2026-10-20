import { interpolateHelp } from './x-lt-help';
import { formatAgoCompact } from './format';
import type { ShowIfContext } from './x-lt-show-if';

/** One `x-lt-columns` entry of an embedded list: a token template and an optional format. */
export interface EmbedColumnDef { label: string; value: string; format?: string }

/**
 * An inline row action: a canned resolve against the row through the
 * standard resolve endpoint, so RBAC and enforce_schema apply as they do to
 * a full-form resolve. String leaves inside `resolverPayload` (and
 * `confirm`) interpolate `{{domain.path}}` tokens against the row.
 */
export interface EmbedActionDef {
  label: string;
  resolverPayload: Record<string, unknown>;
  /** A confirmation asked in place before firing; tokens interpolate per row. */
  confirm?: string;
}

export const EM_DASH = '—';

/** A column's display text for a resolved token value. */
export function renderEmbedValue(raw: string, format?: string): string {
  if (!raw || raw === EM_DASH) return EM_DASH;
  if (format === 'age') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : formatAgoCompact(raw);
  }
  return raw;
}

/** Deep-walk a payload template: string leaves interpolate against the row context; other types pass through typed. */
export function interpolatePayload(value: unknown, ctx: ShowIfContext): unknown {
  if (typeof value === 'string') return interpolateHelp(value, ctx);
  if (Array.isArray(value)) return value.map((v) => interpolatePayload(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolatePayload(v, ctx)]),
    );
  }
  return value;
}
