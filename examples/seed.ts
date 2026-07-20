import { Durable } from '@hotmeshio/hotmesh';

import { JOB_EXPIRE_SECS } from '../modules/defaults';
import { loggerRegistry } from '../lib/logger';
import { getUserByExternalId, createUser } from '../services/user';
import { addUserRole, getUserRoles } from '../services/user/roles';
import { addEscalationChain, createRole } from '../services/role';
import { SEED_USERS, SEED_ROLES, SEED_ENVELOPES, SEED_CHAINS } from './seed-data';
import { seedOrthoRoles } from './seed-ortho';
import { seedTwinRoles } from './seed-twin';
import { seedRichFormRole } from './seed-rich-form';
import { seedPolicyDocumentRole } from './seed-policy-document';
import { seedWorkbenchRole, seedWorkbenchEscalation } from './seed-workbench';
import { seedChecklistRole } from './seed-checklist';
import { seedConstraintFormRole, seedConstraintFormEscalations } from './seed-constraint-form';
import { seedFleetSimRole, seedFleetSimEscalations } from './seed-fleet-sim';

// ── Seed functions ───────────────────────────────────────────────────────────

async function seedRoles(): Promise<void> {
  for (const role of SEED_ROLES) {
    try {
      await createRole(role);
    } catch { /* ON CONFLICT DO NOTHING handles duplicates */ }
  }
  loggerRegistry.info(`[examples] roles verified (${SEED_ROLES.join(', ')})`);
}

async function seedUsers(): Promise<void> {
  for (const userDef of SEED_USERS) {
    try {
      const existing = await getUserByExternalId(userDef.external_id);
      if (existing) {
        // Ensure existing user has the expected roles
        if (userDef.roles?.length) {
          const currentRoles = await getUserRoles(existing.id);
          for (const expected of userDef.roles) {
            const has = currentRoles.some(r => r.role === expected.role && r.type === expected.type);
            if (!has) {
              await addUserRole(existing.id, expected.role, expected.type);
              loggerRegistry.info(`[examples] added role ${expected.role} (${expected.type}) to ${userDef.external_id}`);
            }
          }
        }
        loggerRegistry.info(`[examples] ${userDef.external_id} already exists, skipping`);
        continue;
      }
      await createUser(userDef);
      loggerRegistry.info(`[examples] seeded user (${userDef.external_id} / ${userDef.password})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to seed ${userDef.external_id}: ${err.message}`);
    }
  }
}

async function seedEscalationChains(): Promise<void> {
  for (const [source, target] of SEED_CHAINS) {
    try {
      await addEscalationChain(source, target);
    } catch { /* ON CONFLICT DO NOTHING handles duplicates */ }
  }
  loggerRegistry.info(`[examples] escalation chains verified (${SEED_CHAINS.length} entries)`);
}

/**
 * Seed example workflow configs into lt_config_workflows.
 * Previously done by 002_seed.sql (which ran unconditionally).
 * Now only runs when examples: true.
 */

/**
 * Seed example workflows so the dashboard tells a story immediately.
 * Called automatically when `examples: true` is set in the start config.
 */
export async function seedExamples(client: any): Promise<void> {
  await seedRoles();
  await seedOrthoRoles();
  await seedTwinRoles();
  await seedRichFormRole();
  await seedPolicyDocumentRole();
  await seedWorkbenchRole();
  await seedWorkbenchEscalation();
  await seedChecklistRole();
  await seedConstraintFormRole();
  await seedConstraintFormEscalations();
  await seedFleetSimRole();
  await seedFleetSimEscalations();
  await seedUsers();
  await seedEscalationChains();

  for (const { workflowName, taskQueue, envelope, label } of SEED_ENVELOPES) {
    try {
      const workflowId = `${workflowName}-seed-${Durable.guid().slice(0, 8)}`;
      await client.workflow.start({
        args: [envelope],
        taskQueue,
        workflowName,
        workflowId,
        expire: JOB_EXPIRE_SECS,
        entity: workflowName,
        signalIn: false,
      } as any);
      loggerRegistry.info(`[examples] seeded: ${label} (${workflowId})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] seed failed for ${label}: ${err.message}`);
    }
  }
}
