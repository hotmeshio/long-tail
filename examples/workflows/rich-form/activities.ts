/**
 * Rich Form Activities — post-resolution processing.
 *
 * The input is payload-shaped, not form-shaped: the resolve step already mapped
 * the flat submission through the form's `x-lt-bind` into the nested tree this
 * workflow owns as `IntakeResolverV1`. So this activity reads `customer.name` /
 * `contract.tier`, never `customer_name` / `tier` — the form can be re-laid-out
 * without changing this consumer.
 */

import type { IntakeResolverV1 } from './forms';

export async function processIntake(input: IntakeResolverV1): Promise<{
  received: boolean;
  customerName: string;
  contactEmail: string;
  tier: string;
  approved: boolean;
  processedAt: string;
}> {
  const customer = input.customer ?? {};
  const contract = input.contract ?? {};
  return {
    received: true,
    customerName: customer.name ?? '',
    contactEmail: customer.email ?? '',
    tier: contract.tier ?? '',
    approved: contract.approved ?? false,
    processedAt: new Date().toISOString(),
  };
}
