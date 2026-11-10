/**
 * Item checks: a row type may refuse an item before it is added, beyond its
 * role's form. A machine-request row, for one, refuses an answer its line's
 * codec cannot send. A check returns why the item is refused, or null.
 */

import type { LTEscalationRecord } from '../../types';

export type ItemCheck = (
  row: LTEscalationRecord,
  itemKey: string,
  payload: Record<string, any> | undefined,
) => string | null | Promise<string | null>;

const checks = new Map<string, ItemCheck>();

/** Check every item added to rows of `rowType`; replaces any check registered before. */
export function registerItemCheck(rowType: string, check: ItemCheck): void {
  checks.set(rowType, check);
}

/** Stop checking items on `rowType` rows, when `check` is still the one registered. */
export function unregisterItemCheck(rowType: string, check?: ItemCheck): void {
  if (!check || checks.get(rowType) === check) checks.delete(rowType);
}

/** Why the item is refused; null when its row type has no check or the check accepts it. */
export async function checkItem(row: LTEscalationRecord, itemKey: string, payload: Record<string, any> | undefined): Promise<string | null> {
  const check = checks.get(row.type);
  return check ? check(row, itemKey, payload) : null;
}
