/**
 * Technician activity — resolve pending `needs-filament` adverts ("added filament").
 * The same human-in-the-loop mechanism the platform uses everywhere; automated here
 * so the example self-drains. Resolving a maintenance advert wakes its printer.
 */

import { createClient } from '../../../../sdk';

import { PRINTER_POND, PRINTER_FACETS, PRINTER_STATE, fleetKind } from '../types';
import type { RefillSummary, TechnicianData } from '../types';

export async function technicianRefill(input: TechnicianData): Promise<RefillSummary> {
  const kind = fleetKind(input.diabetic);
  const printerPond = PRINTER_POND[kind];

  // Run as the technician operator — a principal holding the printer pond role.
  const lt = createClient({ auth: { userId: input.technicianId } });

  const maintenance = await lt.escalations.searchByFacets({
    role: printerPond,
    status: 'pending',
    available: true,
    facets: { [PRINTER_FACETS.STATE]: PRINTER_STATE.MAINTENANCE },
    limit: 100,
  });
  if (maintenance.status !== 200) throw new Error(`searchByFacets failed: ${maintenance.error}`);

  const refilled: string[] = [];
  // Each maintenance advert is a signal_key row whose resolution must DELIVER the
  // refill signal to wake its printer — so it stays per-row, not set-based.
  for (const e of maintenance.data.escalations) {
    const res = await lt.escalations.resolve({ id: e.id, resolverPayload: { action: 'added-filament' } });
    if (res.status === 200) {
      const m = (e.metadata ?? {}) as Record<string, any>;
      refilled.push(m[PRINTER_FACETS.PRINTER_ID]);
    }
  }
  return { refilled: refilled.length, printerIds: refilled };
}
