/** Return true if a Postgres error indicates an invalid/missing ID */
export function isNotFoundError(err: any): boolean {
  const msg: string = err?.message ?? '';
  return msg.includes('invalid input syntax for type uuid') || msg.includes('not found');
}
