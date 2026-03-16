/**
 * Parse a HotMesh-encoded value string.
 * Values may be prefixed with `/s` (string type marker).
 */
export function parseHmshValue(raw: string): unknown {
  const json = raw.startsWith('/s') ? raw.slice(2) : raw;
  return JSON.parse(json);
}
