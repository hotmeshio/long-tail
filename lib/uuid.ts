/**
 * UUID shape guard for open input reaching uuid-typed columns. Postgres
 * throws `invalid input syntax for type uuid` on a bad cast, so every
 * caller-supplied id must pass this gate BEFORE it reaches SQL — a
 * non-UUID string is definitionally not-found, never a 500.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** The UUID members of a caller-supplied id list; non-UUIDs are dropped —
 *  they can match nothing, exactly like a well-formed id that does not exist. */
export function onlyUuids(ids: string[]): string[] {
  return ids.filter((id) => isUuid(id));
}
