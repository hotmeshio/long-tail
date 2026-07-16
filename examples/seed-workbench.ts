/**
 * Workbench role config — declares the `cad-designer` role with an iframe
 * viewport that embeds a WebGL CAD editor. Each escalation carries
 * `workbenchId` and `companyId` in its payload; the dashboard expands those
 * tokens into the iframe src URL at render time.
 *
 * Claim-and-resolve flow:
 *   1. Operator navigates to the detail page → claim bar appears.
 *   2. Operator claims the item → iframe loads the editor, receives full
 *      escalation context (envelope + metadata + payload) via lt:init.
 *   3. Operator completes the design; the editor saves to object storage and
 *      posts `lt:submit` with `{ stl_url: '...' }` to the parent frame.
 *   4. The dashboard resolves the escalation and navigates back to the list.
 *
 * Set WORKBENCH_BASE_URL to point at your editor service
 * (default: http://localhost:3016).
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { createEscalation, listEscalations } from '../services/escalation';
import { loggerRegistry } from '../lib/logger';

export const WORKBENCH_ROLE = 'cad-designer';

const BASE_URL = process.env.WORKBENCH_BASE_URL || 'http://localhost:3016';

const WORKBENCH_FORM_SCHEMA = {
  'x-lt-viewport': {
    type: 'iframe',
    src: `${BASE_URL}/design?workbenchId={workbenchId}&companyId={companyId}`,
  },
  properties: {
    stl_url: {
      type: 'string',
      title: 'STL File URL',
      description: 'Object-storage URL of the completed design, set by the embedded editor.',
    },
  },
};

export async function seedWorkbenchRole(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(WORKBENCH_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  if (created) {
    try {
      await updateRoleMetadata(WORKBENCH_ROLE, {
        title: 'CAD Designer',
        description: 'Designs the orthotic insole using the embedded 3D editor.',
        ops_visible: true,
        parent_role: null,
        sla_minutes: 30,
        target_per_hour: 4,
        form_schema: WORKBENCH_FORM_SCHEMA,
      });
      loggerRegistry.info(`[examples] workbench role created (${WORKBENCH_ROLE})`);
      return;
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to configure workbench role: ${err.message}`);
      return;
    }
  }

  const row = existing.get(WORKBENCH_ROLE);
  const unconfigured = row != null && row.title == null;
  if (unconfigured) {
    try {
      await updateRoleMetadata(WORKBENCH_ROLE, {
        title: 'CAD Designer',
        description: 'Designs the orthotic insole using the embedded 3D editor.',
        ops_visible: true,
        parent_role: null,
        sla_minutes: 30,
        target_per_hour: 4,
        form_schema: WORKBENCH_FORM_SCHEMA,
      });
      loggerRegistry.info(`[examples] workbench role configured (${WORKBENCH_ROLE})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to configure workbench role: ${err.message}`);
    }
    return;
  }

  // Always push the latest schema so URL template changes take effect on boot.
  try {
    await updateRoleMetadata(WORKBENCH_ROLE, { form_schema: WORKBENCH_FORM_SCHEMA });
    loggerRegistry.info(`[examples] workbench schema refreshed (${WORKBENCH_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to refresh workbench schema: ${err.message}`);
  }
}

/**
 * Seed one pending escalation for the cad-designer role so the iframe
 * viewport can be exercised immediately after startup. Reads workbenchId
 * and companyId from env vars so the dev environment can point at any
 * workbench session without code changes.
 *
 * Skips creation when a pending cad-designer escalation already exists.
 */
export async function seedWorkbenchEscalation(): Promise<void> {
  const workbenchId = process.env.WORKBENCH_ID;
  const companyId = process.env.COMPANY_ID;
  if (!workbenchId || !companyId) {
    loggerRegistry.info('[examples] WORKBENCH_ID / COMPANY_ID not set — skipping workbench escalation seed');
    return;
  }

  try {
    const { escalations: existing } = await listEscalations({ role: WORKBENCH_ROLE, status: 'pending', limit: 1 });
    if (existing.length > 0) {
      loggerRegistry.info('[examples] workbench escalation already exists, skipping');
      return;
    }

    await createEscalation({
      type: 'cad',
      subtype: 'insole-design',
      description: 'Design the orthotic insole for this order.',
      priority: 2,
      role: WORKBENCH_ROLE,
      envelope: JSON.stringify({}),
      escalation_payload: JSON.stringify({ workbenchId, companyId }),
    });
    loggerRegistry.info(`[examples] workbench test escalation seeded (workbenchId=${workbenchId})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed workbench escalation: ${err.message}`);
  }
}
