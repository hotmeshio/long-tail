/**
 * Lookup-cascade seed — versioned knowledge entries, the `catalog-picker`
 * role, and two test escalations pinned to DIFFERENT editions of the same
 * entry:
 *
 *   - catalog/materials is written twice: the first write is v1 (three
 *     items), the second replaces the list with five — the auto-versioning
 *     write mints v2. One escalation pins v1, the other v2, so both editions
 *     render side by side from ONE role form.
 *   - catalog/geo carries the cascade map (countries → regions) read by
 *     `lookup.geo.regions.{{resolver.country}}`.
 *   - catalog/checks carries the checklist items.
 *
 * Knowledge seeding is guarded on first-boot: re-running against an existing
 * catalog would re-mint editions, so an existing entry skips the writes.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { createEscalation, listEscalations } from '../services/escalation';
import { storeKnowledge, getKnowledge } from '../system/activities/knowledge';
import { loggerRegistry } from '../lib/logger';
import { CASCADE_ROLE, CASCADE_FORM_SCHEMA } from './workflows/lookup-cascade/forms';

const CATALOG_DOMAIN = 'catalog';

export async function seedLookupCascadeKnowledge(): Promise<void> {
  try {
    const existing = await getKnowledge({ domain: CATALOG_DOMAIN, key: 'materials' });
    if (existing.found !== false) {
      loggerRegistry.info('[examples] lookup-cascade catalog entries already exist, skipping');
      return;
    }

    // v1: the original material list.
    await storeKnowledge({
      domain: CATALOG_DOMAIN,
      key: 'materials',
      data: { items: ['aluminum', 'steel', 'copper'] },
      tags: ['lookup'],
    });
    // v2: two materials added — the data change mints a new edition.
    await storeKnowledge({
      domain: CATALOG_DOMAIN,
      key: 'materials',
      data: { items: ['aluminum', 'steel', 'copper', 'titanium', 'composite'] },
      tags: ['lookup'],
    });

    await storeKnowledge({
      domain: CATALOG_DOMAIN,
      key: 'geo',
      data: {
        countries: ['US', 'EU'],
        regions: {
          US: ['CA', 'NY', 'TX'],
          // Object options: the select shows the label, the payload stores
          // the value — the shape for DB-backed pick lists.
          EU: [
            { value: 'de-1', label: 'Germany' },
            { value: 'fr-1', label: 'France' },
            { value: 'es-1', label: 'Spain' },
          ],
        },
      },
      tags: ['lookup'],
    });

    await storeKnowledge({
      domain: CATALOG_DOMAIN,
      key: 'checks',
      data: {
        items: [
          { id: 'stock_confirmed', label: 'Material is in stock', required: true },
          { id: 'spec_reviewed', label: 'Order spec has been reviewed', required: true },
          { id: 'photos', label: 'Reference photos are attached', required: false },
        ],
      },
      tags: ['lookup'],
    });

    loggerRegistry.info('[examples] lookup-cascade catalog entries seeded (materials v1+v2, geo, checks)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed lookup-cascade knowledge: ${err.message}`);
  }
}

export async function seedLookupCascadeRole(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(CASCADE_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  const row = existing.get(CASCADE_ROLE);
  const unconfigured = row != null && row.title == null;
  if (!created && !unconfigured) {
    loggerRegistry.info(`[examples] lookup-cascade role ${CASCADE_ROLE} already configured, skipping`);
    return;
  }

  try {
    await updateRoleMetadata(CASCADE_ROLE, {
      title: 'Catalog Picker',
      description: 'Picks materials and destinations — the reference example for versioned knowledge lookups (x-lt-options from the lookup domain, cascading selects, lookup-sourced checklist).',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 20,
      target_per_hour: 6,
      form_schema: CASCADE_FORM_SCHEMA,
      // Membership against the pinned editions is enforced server-side: a raw
      // API resolve with an out-of-edition option rejects as the canonical 422.
      enforce_schema: true,
    });
    loggerRegistry.info(`[examples] lookup-cascade role verified (${CASCADE_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update lookup-cascade role ${CASCADE_ROLE}: ${err.message}`);
  }
}

/** Seed two test escalations pinned to different material editions. */
export async function seedLookupCascadeEscalations(): Promise<void> {
  try {
    const { escalations: existing } = await listEscalations({
      role: CASCADE_ROLE,
      status: 'pending',
      limit: 1,
    });
    if (existing.length > 0) {
      loggerRegistry.info('[examples] lookup-cascade escalations already exist, skipping');
      return;
    }

    const sharedRefs = [
      { domain: CATALOG_DOMAIN, key: 'geo', version: 1 },
      { domain: CATALOG_DOMAIN, key: 'checks', version: 1 },
    ];

    await createEscalation({
      type: 'catalog',
      subtype: 'catalog-pick',
      description: 'Catalog pick — materials edition v1 (three materials in the dropdown)',
      priority: 2,
      role: CASCADE_ROLE,
      envelope: JSON.stringify({
        formDefaults: { checks: {} },
        lookups: [
          { domain: CATALOG_DOMAIN, key: 'materials', version: 1 },
          ...sharedRefs,
        ],
      }),
      escalation_payload: JSON.stringify({ orderId: 'ord-101' }),
    });

    await createEscalation({
      type: 'catalog',
      subtype: 'catalog-pick',
      description: 'Catalog pick — materials edition v2 (five materials in the dropdown)',
      priority: 2,
      role: CASCADE_ROLE,
      envelope: JSON.stringify({
        formDefaults: { checks: {} },
        lookups: [
          { domain: CATALOG_DOMAIN, key: 'materials', version: 2 },
          ...sharedRefs,
        ],
      }),
      escalation_payload: JSON.stringify({ orderId: 'ord-102' }),
    });

    // A parked pre-migration row: NO refs, every list embedded in its own
    // envelope. The shared schema's ordered sources fall through to the
    // envelope, so this row renders the identical form beside the ref-pinned
    // rows — the strand-free migration the interchangeable sources exist for.
    await createEscalation({
      type: 'catalog',
      subtype: 'catalog-pick',
      description: 'Catalog pick — parked pre-migration row (embedded lists, no refs)',
      priority: 3,
      role: CASCADE_ROLE,
      envelope: JSON.stringify({
        formDefaults: { checks: {} },
        material_options: ['aluminum', 'steel', 'copper'],
        geo: {
          countries: ['US', 'EU'],
          regions: {
            US: ['CA', 'NY', 'TX'],
            EU: [
              { value: 'de-1', label: 'Germany' },
              { value: 'fr-1', label: 'France' },
              { value: 'es-1', label: 'Spain' },
            ],
          },
        },
        checklist_items: [
          { id: 'stock_confirmed', label: 'Material is in stock', required: true },
          { id: 'spec_reviewed', label: 'Order spec has been reviewed', required: true },
          { id: 'photos', label: 'Reference photos are attached', required: false },
        ],
      }),
      escalation_payload: JSON.stringify({ orderId: 'ord-103' }),
    });

    loggerRegistry.info('[examples] lookup-cascade test escalations seeded (3)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed lookup-cascade escalations: ${err.message}`);
  }
}
