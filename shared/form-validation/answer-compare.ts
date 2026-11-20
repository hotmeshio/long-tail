/**
 * How two answers compare as a reviewer reads them: empty answers are equal,
 * "42" equals 42, whitespace-only edits are not changes, and key order is
 * ignored. Array order is significant here; list review decides when it is not.
 */

/** Text compared by its words: surrounding and repeated whitespace is not a change. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function stableJson(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(normalizeText(value));
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A value's comparable form: empty answers compare equal, "42" equals 42,
 * whitespace-only edits are not changes, and key order is ignored.
 */
export function comparable(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return stableJson(value);
  return normalizeText(String(value));
}

