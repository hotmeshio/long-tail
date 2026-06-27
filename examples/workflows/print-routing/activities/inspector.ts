/**
 * Inspector (farmer) activity — resolve pending order-done signoff escalations. The
 * farmer inspects each printed order and rejects defective insoles (`failedUnits`);
 * resolving wakes the parked order, which reprints whatever was rejected. Automated
 * here so the example self-drains; in production a dashboard operator signs off.
 */

import * as escalationService from '../../../../services/escalation';
import * as escalationApi from '../../../../api/escalations';

import { FARMER_POND, SIGNOFF_FACETS, fleetKind } from '../types';
import type { InspectorData, SignoffSummary } from '../types';

export async function inspectorSignoff(input: InspectorData): Promise<SignoffSummary> {
  const kind = fleetKind(input.diabetic);
  const farmerPond = FARMER_POND[kind];
  const inspectorId = input.inspectorId ?? `inspector-${kind}`;

  const { escalations } = await escalationService.searchByFacets({
    role: farmerPond,
    status: 'pending',
    available: true,
    limit: 100,
  });

  const signedOff: string[] = [];
  for (const e of escalations) {
    const m = (e.metadata ?? {}) as Record<string, any>;
    const failedUnits: number[] = Array.isArray(m[SIGNOFF_FACETS.FAIL_UNITS]) ? m[SIGNOFF_FACETS.FAIL_UNITS] : [];
    const res = await escalationApi.resolveEscalation(
      { id: e.id, resolverPayload: { passed: failedUnits.length === 0, inspectedBy: inspectorId, failedUnits } },
      { userId: inspectorId },
    );
    if (res.status === 200) signedOff.push(m[SIGNOFF_FACETS.ORDER_ID]);
  }
  return { signedOff: signedOff.length, orderIds: signedOff };
}
