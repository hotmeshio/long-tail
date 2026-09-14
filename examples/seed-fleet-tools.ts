/**
 * Fleet-tools seed: the database as a versioned source of truth.
 *
 * The invoke form's serial select reads `lookup.serials.items`. That list is
 * not typed into config: on every boot the seed queries the escalation store
 * for the printers the fleet has actually seen (one group per serial and
 * facility) and writes the result as a knowledge entry. Knowledge writes
 * auto-version only when the data changes, so an unchanged fleet leaves the
 * edition alone and a changed fleet mints the next one. The worker config
 * pins one edition, so every operator sees the same list until the pin moves;
 * a newer edition is logged so the pin can be advanced deliberately.
 *
 * The material catalog is static content written once; its editions move
 * when the catalog is edited in the knowledge store.
 */

import { aggregateByFacets } from '../services/escalation';
import { storeKnowledge, getKnowledge } from '../system/activities/knowledge';
import { loggerRegistry } from '../lib/logger';
import { FLEET_SERIALS_LOOKUP, FLEET_MATERIALS_LOOKUP } from './workflows/fleet-tools/forms';
import { PRINTER_ENTITY_FACET } from './seed-fleet-sim';

const FACILITY_FACET = 'facility';

export interface FleetSerialOption {
  value: string;
  label: string;
}

/** One labeled option per serial from the aggregate rows, sorted by serial; a serial with no facility is labeled by itself. */
export function fleetSerialOptions(rows: Array<{ facets: Record<string, string | null> }>): FleetSerialOption[] {
  const seen = new Map<string, FleetSerialOption>();
  for (const row of rows) {
    const serial = row.facets[PRINTER_ENTITY_FACET];
    if (!serial || seen.has(serial)) continue;
    const facility = row.facets[FACILITY_FACET];
    seen.set(serial, { value: serial, label: facility ? `${serial} (${facility})` : serial });
  }
  return [...seen.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/** The printers the fleet has seen, read from the escalation store. */
export async function readFleetSerialOptions(): Promise<FleetSerialOption[]> {
  const { groups } = await aggregateByFacets({
    query: {},
    groupBy: { facets: [PRINTER_ENTITY_FACET, FACILITY_FACET] },
    measure: { kind: 'membership' },
  });
  return fleetSerialOptions(groups);
}

export const FLEET_MATERIALS = {
  items: ['PLA', 'PETG', 'TPU'],
  colors: {
    PLA: ['white', 'black', 'grey'],
    PETG: [{ value: 'clear', label: 'Clear' }, { value: 'smoke', label: 'Smoke' }],
    TPU: ['black'],
  },
};

export async function seedFleetToolsKnowledge(): Promise<void> {
  try {
    const items = await readFleetSerialOptions();
    if (items.length === 0) {
      loggerRegistry.info('[examples] no fleet serials in the escalation store yet; serial list not written');
    } else {
      const stored = await storeKnowledge({
        domain: FLEET_SERIALS_LOOKUP.domain,
        key: FLEET_SERIALS_LOOKUP.key,
        data: { items },
        tags: ['lookup'],
      });
      loggerRegistry.info(`[examples] fleet serial list edition v${stored.current_version} holds ${items.length} printers`);
      if (stored.current_version > FLEET_SERIALS_LOOKUP.version) {
        loggerRegistry.info(`[examples] fleetTools pins serial edition v${FLEET_SERIALS_LOOKUP.version}; v${stored.current_version} is available to pin`);
      }
    }

    const existing = await getKnowledge({ domain: FLEET_MATERIALS_LOOKUP.domain, key: FLEET_MATERIALS_LOOKUP.key });
    if (existing.found === false) {
      await storeKnowledge({
        domain: FLEET_MATERIALS_LOOKUP.domain,
        key: FLEET_MATERIALS_LOOKUP.key,
        data: FLEET_MATERIALS,
        tags: ['lookup'],
      });
      loggerRegistry.info('[examples] fleet material catalog seeded (v1)');
    }
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed fleet-tools knowledge: ${err.message}`);
  }
}
