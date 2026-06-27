/**
 * Technician activity — resolve pending `needs-filament` adverts ("added filament").
 * The same human-in-the-loop mechanism the platform uses everywhere; automated here
 * so the example self-drains. Resolving a maintenance advert wakes its printer.
 */

import * as escalationService from '../../../../services/escalation';
import * as escalationApi from '../../../../api/escalations';

import { PRINTER_POND, PRINTER_FACETS, PRINTER_STATE, fleetKind } from '../types';
import type { RefillSummary, TechnicianData } from '../types';

export async function technicianRefill(input: TechnicianData): Promise<RefillSummary> {
  const kind = fleetKind(input.diabetic);
  const printerPond = PRINTER_POND[kind];
  const technicianId = input.technicianId ?? `tech-${kind}`;

  const { escalations } = await escalationService.searchByFacets({
    role: printerPond,
    status: 'pending',
    available: true,
    facets: { [PRINTER_FACETS.STATE]: PRINTER_STATE.MAINTENANCE },
    limit: 100,
  });

  const refilled: string[] = [];
  for (const e of escalations) {
    const res = await escalationApi.resolveEscalation(
      { id: e.id, resolverPayload: { action: 'added-filament' } },
      { userId: technicianId },
    );
    if (res.status === 200) {
      const m = (e.metadata ?? {}) as Record<string, any>;
      refilled.push(m[PRINTER_FACETS.PRINTER_ID]);
    }
  }
  return { refilled: refilled.length, printerIds: refilled };
}
