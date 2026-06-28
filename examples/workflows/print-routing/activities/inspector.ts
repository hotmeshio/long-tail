/**
 * Inspector (farmer) activity — resolve pending order-done signoff escalations. The
 * farmer inspects each printed order and rejects defective insoles (`failedUnits`);
 * resolving wakes the parked order, which reprints whatever was rejected. Automated
 * here so the example self-drains; in production a dashboard operator signs off.
 */

import { createClient } from '../../../../sdk';

import { FARMER_POND, SIGNOFF_FACETS, fleetKind } from '../types';
import type { InspectorData, SignoffSummary } from '../types';

export async function inspectorSignoff(input: InspectorData): Promise<SignoffSummary> {
  const kind = fleetKind(input.diabetic);
  const farmerPond = FARMER_POND[kind];

  // Run as the inspector operator — a principal holding the farmer pond role. Bind the
  // auth once on the SDK client; the dependent project's code reads exactly like this.
  const lt = createClient({ auth: { userId: input.inspectorId } });

  const pending = await lt.escalations.searchByFacets({
    role: farmerPond,
    status: 'pending',
    available: true,
    limit: 100,
  });
  if (pending.status !== 200) throw new Error(`searchByFacets failed: ${pending.error}`);

  const signedOff: string[] = [];
  // Each signoff is a signal_key advert with a DISTINCT payload (its own failedUnits)
  // whose resolution must DELIVER the signal to wake the parked order — so it stays
  // per-row, not set-based.
  for (const e of pending.data.escalations) {
    const m = (e.metadata ?? {}) as Record<string, any>;
    const failedUnits: number[] = Array.isArray(m[SIGNOFF_FACETS.FAIL_UNITS]) ? m[SIGNOFF_FACETS.FAIL_UNITS] : [];
    const res = await lt.escalations.resolve({
      id: e.id,
      resolverPayload: { passed: failedUnits.length === 0, inspectedBy: input.inspectorId, failedUnits },
    });
    if (res.status === 200) signedOff.push(m[SIGNOFF_FACETS.ORDER_ID]);
  }
  return { signedOff: signedOff.length, orderIds: signedOff };
}
