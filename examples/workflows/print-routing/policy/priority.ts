/**
 * Priority policy — the business layer. When more orders are claimable than there
 * are printers free, *which runs first* is a business decision, so it lives where
 * the business can reach it: a registry of named rules, each a sort fragment, and
 * an ordered list naming the rules to apply. The broker composes the list into a
 * `FacetOrder[]` and hands it to `claimGroups` — it never hard-codes the sequence.
 *
 * Each rule is legible and independent. Reorder the list, or pass a different one
 * per broker (`BrokerData.priorityRules`), and the queue reorders — no code change
 * in the broker, no deploy. This is the funnel's fourth stage made pluggable.
 */

import type { FacetOrder } from '../../../../types';

import { PRINT_FACETS } from '../types';

/** Customers whose orders jump the queue (safe generic ids; a real fleet keys off CRM). */
export const KEY_ACCOUNTS: ReadonlySet<string> = new Set(['kacct-1', 'kacct-2']);

export function isKeyAccount(customerId: string): boolean {
  return KEY_ACCOUNTS.has(customerId);
}

/**
 * The named rules. Booleans (`keyAccount`, `reprint`) sort `true` before `false`
 * with a text DESC; the time/size rules sort numerically. Add a rule here and it
 * is immediately namable in a policy.
 */
export const PRIORITY_RULES: Record<string, FacetOrder[]> = {
  // Past-due first: the soonest deadline (most jeopardy) leads.
  pastDue: [{ field: `metadata.${PRINT_FACETS.MUST_COMPLETE_BY}`, numeric: true, direction: 'asc' }],
  // A key account leads the queue.
  keyAccount: [{ field: `metadata.${PRINT_FACETS.KEY_ACCOUNT}`, direction: 'desc' }],
  // A remake (reprint) leads — the convergence loop's work is finished fast.
  reprint: [{ field: `metadata.${PRINT_FACETS.REPRINT}`, direction: 'desc' }],
  // Largest order first (pack the scarce machine).
  largest: [{ field: `metadata.${PRINT_FACETS.ORDER_SIZE}`, numeric: true, direction: 'desc' }],
  // First-in-first-out: the fair default.
  fifo: [{ field: 'created_at', direction: 'asc' }],
};

/** The standing policy: jeopardy, then key accounts, then reprints, then fairness. */
export const DEFAULT_PRIORITY_RULES = ['pastDue', 'keyAccount', 'reprint', 'fifo'];

/** Compose an ordered list of rule names into a single `FacetOrder[]`. */
export function composePriorityOrder(ruleNames: string[] = DEFAULT_PRIORITY_RULES): FacetOrder[] {
  return ruleNames.flatMap((name) => PRIORITY_RULES[name] ?? []);
}
