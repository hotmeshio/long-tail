/**
 * Lookup Cascade Workflow — the reference example for versioned knowledge
 * lookups. The `catalog-picker` role owns ONE static form; each escalation
 * names the knowledge entries its dropdowns read:
 *
 *   - lookups: [{ domain, key, version? }]  — a version pins an immutable
 *     edition; no version (or 'current') follows the newest edition, so a
 *     write to the entry shows on every open row's next render.
 *   - The form addresses the content as the `lookup.*` context domain:
 *     `x-lt-options: "lookup.materials.items"`, and the cascade pair
 *     `lookup.geo.regions.{{resolver.country}}`.
 *
 * Invoke via the dashboard (Workflows → lookupCascade) with:
 *   {
 *     data: { materials_version: 2 },
 *     metadata: { source: 'dashboard' }
 *   }
 *
 * Invoke once with materials_version 1 and once with 2 to see two rows offer
 * different material sets from the SAME role form; 'current' follows the
 * newest edition. Omit it for the default.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { LOOKUP_VERSION_CURRENT, type LTEnvelope } from '../../../types';
import { conditional } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import { CASCADE_ROLE, CASCADE_SCHEMA_VERSION, type CascadeResolverV1 } from './forms';

type ActivitiesType = typeof activities;

// The editions this code is written for. Bump alongside the payload type when
// the catalog evolves — same discipline as schemaVersion.
const DEFAULT_MATERIALS_VERSION = 2;
const GEO_VERSION = 1;
const CHECKS_VERSION = 1;

export async function lookupCascade(envelope: LTEnvelope): Promise<any> {
  const requested = envelope.data.materials_version ?? DEFAULT_MATERIALS_VERSION;
  const materialsVersion = requested === LOOKUP_VERSION_CURRENT ? LOOKUP_VERSION_CURRENT : Number(requested);

  const { processCatalogPick } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `lookup-cascade-${ctx.workflowId}`;

  const decision = await conditional<CascadeResolverV1>(signalId, {
    role: CASCADE_ROLE,
    type: 'catalog',
    subtype: 'catalog-pick',
    priority: 2,
    description: `Catalog pick — materials edition ${materialsVersion === LOOKUP_VERSION_CURRENT ? 'current' : `v${materialsVersion}`}`,
    workflowType: 'lookupCascade',
    envelope: {
      source: 'lookup-cascade',
      formDefaults: { checks: {} },
    },
    lookups: [
      { domain: 'catalog', key: 'materials', version: materialsVersion },
      { domain: 'catalog', key: 'geo', version: GEO_VERSION },
      { domain: 'catalog', key: 'checks', version: CHECKS_VERSION },
    ],
    schemaVersion: CASCADE_SCHEMA_VERSION,
  });

  if (!decision) {
    return { type: 'return' as const, data: { cancelled: true } };
  }

  const result = await processCatalogPick(decision);
  return { type: 'return' as const, data: result };
}
