/**
 * Rich Form Activities — post-resolution processing.
 *
 * The input is payload-shaped, not form-shaped: the resolve step already mapped
 * the flat submission through the form's `x-lt-bind` into the nested tree this
 * workflow owns as `IntakeResolverV1`. So this activity reads `customer.name` /
 * `contract.tier`, never `customer_name` / `tier` — the form can be re-laid-out
 * without changing this consumer.
 *
 * `parseResolverPayload` runs the declared zod schema over the resolution at
 * the activity boundary: business logic below works with a checked, typed
 * value, and a non-conforming payload fails loud with a per-field violation
 * list rather than propagating partial data.
 */

import { parseResolverPayload } from '../../../lib/typed-resolution';

import { IntakeResolverV1Schema, type IntakeResolverV1 } from './forms';

export async function processIntake(input: IntakeResolverV1): Promise<{
  received: boolean;
  customerName: string;
  contactEmail: string;
  tier: string;
  approved: boolean;
  processedAt: string;
}> {
  const intake = parseResolverPayload(IntakeResolverV1Schema, input);
  return {
    received: true,
    customerName: intake.customer.name,
    contactEmail: intake.customer.email,
    tier: intake.contract.tier,
    approved: intake.contract.approved,
    processedAt: new Date().toISOString(),
  };
}
