/**
 * Lookup Cascade Workflow — the reference example for versioned knowledge
 * lookups. The `catalog-picker` role owns ONE static form; each escalation
 * pins the knowledge editions its dropdowns read:
 *
 *   - lookups: [{ domain, key, version }]  — version REQUIRED; a ref names an
 *     immutable edition. Evolve the list by writing the entry (a new version
 *     mints automatically) and repinning the literal here.
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
 * different material sets from the SAME role form. Omit it for the default.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
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
  const materialsVersion: number = Number(envelope.data.materials_version ?? DEFAULT_MATERIALS_VERSION);

  const { processCatalogPick } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `lookup-cascade-${ctx.workflowId}`;

  const decision = await conditional<CascadeResolverV1>(signalId, {
    role: CASCADE_ROLE,
    type: 'catalog',
    subtype: 'catalog-pick',
    priority: 2,
    description: `Catalog pick — materials edition v${materialsVersion}`,
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
