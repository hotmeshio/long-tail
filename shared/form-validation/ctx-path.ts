/**
 * Context-path resolution shared by every token that names a `"domain.path"`.
 *
 * A path may embed `{{domain.path}}` interpolation segments — the same
 * grammar as x-lt-help tokens — resolved against the live context before the
 * walk. This is what makes cascading selects work: a field can declare
 *
 *   x-lt-options: "lookup.geo.regions.{{resolver.country}}"
 *
 * and its option list follows the submitter's country answer, re-resolved
 * locally on every edit. An unresolved segment means "no concrete path yet",
 * never a literal placeholder.
 */
import { getDeep } from './x-lt-bind';

export const INTERPOLATION_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Whether a token embeds `{{domain.path}}` interpolation segments. */
export function hasInterpolation(token: unknown): token is string {
  return typeof token === 'string' && /\{\{[^{}]+\}\}/.test(token);
}

/** Resolve a concrete `"domain.path"` (x-lt-bind syntax, `a.b[0].c`) against the context. */
export function resolveCtxPath(
  path: string,
  ctx: Record<string, unknown> | undefined,
): unknown {
  if (!ctx) return undefined;
  const dot = path.indexOf('.');
  const root = ctx[dot === -1 ? path : path.slice(0, dot)];
  if (dot === -1) return root;
  if (root === null || typeof root !== 'object') return undefined;
  return getDeep(root, path.slice(dot + 1));
}

/**
 * Interpolate every `{{domain.path}}` segment against the context. Returns
 * the concrete path, or null when any segment resolves to nothing (missing,
 * null, empty string) or to a non-scalar — an unanswered cascade parent
 * yields no path, so the dependent field offers nothing.
 */
export function interpolatePath(
  template: string,
  ctx: Record<string, unknown> | undefined,
): string | null {
  let unresolved = false;
  const concrete = template.replace(INTERPOLATION_PATTERN, (_match, rawPath: string) => {
    const value = resolveCtxPath(rawPath, ctx);
    if (typeof value === 'string' && value.trim().length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    unresolved = true;
    return '';
  });
  return unresolved ? null : concrete;
}
