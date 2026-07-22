/**
 * Acme station activities — post-resolution processing for each stage.
 *
 * Inputs are payload-shaped, not form-shaped: the resolve step already mapped
 * the flat submission through each form's `x-lt-bind` into the nested tree the
 * workflow owns. `parseResolverPayload` runs the declared zod schema at the
 * activity boundary so business logic works with a checked, typed value.
 */

import { parseResolverPayload } from '../../../lib/typed-resolution';

import {
  AcmeAddonsResolverV1Schema,
  AcmeQaResolverV1Schema,
  type AcmeAddonsResolverV1,
  type AcmeQaResolverV1,
} from './forms';

export interface StationOutcome {
  station: string;
  outcome: string;
  reportedReason?: string;
  sendBackTo?: string;
  processedAt: string;
}

export async function processAddons(input: AcmeAddonsResolverV1): Promise<StationOutcome> {
  const result = parseResolverPayload(AcmeAddonsResolverV1Schema, input);
  return {
    station: 'addons',
    outcome: result.outcome,
    reportedReason: result.report?.reason,
    sendBackTo: result.report?.sendBackTo,
    processedAt: new Date().toISOString(),
  };
}

export async function processQa(input: AcmeQaResolverV1): Promise<StationOutcome> {
  const result = parseResolverPayload(AcmeQaResolverV1Schema, input);
  return {
    station: 'post-print-qa',
    outcome: result.outcome,
    reportedReason: result.report?.reason,
    sendBackTo: result.report?.sendBackTo,
    processedAt: new Date().toISOString(),
  };
}
