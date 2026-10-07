/** `catalog/materials v2`, or `catalog/materials (current)` for a ref that follows the newest edition. */
export function lookupLabel(l: { domain: string; key: string; version: number | null; current?: true }): string {
  return `${l.domain}/${l.key} ${l.current || l.version === null ? '(current)' : `v${l.version}`}`;
}
