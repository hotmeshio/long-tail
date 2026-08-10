/**
 * Dot-path projection over a JSON value — the token-efficiency primitive for
 * large tool results (workflow exports, execution histories). `pickPaths`
 * returns a new object holding only the requested paths, preserving their
 * nesting; a path that does not resolve is silently omitted. Numeric segments
 * index arrays ("timeline.0.activity").
 */

/** Resolve one dotted path against a value; undefined when any segment is missing. */
export function resolveJsonPath(value: unknown, path: string): unknown {
  const segments = path.trim().split('.').filter((s) => s.length > 0);
  let current: any = value;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

/** Set one dotted path on a target, creating intermediate objects/arrays. */
function setJsonPath(target: Record<string, any>, path: string, value: unknown): void {
  const segments = path.trim().split('.').filter((s) => s.length > 0);
  let current: any = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (current[segment] == null || typeof current[segment] !== 'object') {
      // A numeric NEXT segment means this level is an array.
      current[segment] = /^\d+$/.test(segments[i + 1]) ? [] : {};
    }
    current = current[segment];
  }
  current[segments[segments.length - 1]] = value;
}

/**
 * Project a value down to the given dot paths. Empty/absent `paths` returns
 * the value unchanged (no projection requested).
 */
export function pickPaths<T>(value: T, paths?: string[]): T | Record<string, any> {
  if (!paths || paths.length === 0) return value;
  const out: Record<string, any> = {};
  for (const path of paths) {
    const resolved = resolveJsonPath(value, path);
    if (resolved !== undefined) setJsonPath(out, path, resolved);
  }
  return out;
}
