import { Durable } from '@hotmeshio/hotmesh';

import { JOB_EXPIRE_SECS } from '../modules/defaults';
import { loggerRegistry } from '../lib/logger';
import { getUserByExternalId, createUser, updateUser } from '../services/user';
import { addUserRole, getUserRoles } from '../services/user/roles';
import { addEscalationChain, createRole } from '../services/role';
import { seedPersonas as seedPersonaSpecs } from '../services/persona';
import { SEED_USERS, SEED_ROLES, SEED_ENVELOPES, SEED_CHAINS, SEED_PERSONAS } from './seed-data';
import { seedOrthoRoles } from './seed-ortho';
import { seedTwinRoles } from './seed-twin';
import { seedScanCodes, seedBadgeScheme } from './seed-scan-codes';
import { seedRichFormRole } from './seed-rich-form';
import { seedAcmeRoles } from './seed-acme';
import { seedRelatedEscalationsRoles } from './seed-related-escalations';
import { seedTransitionChainRoles } from './seed-transition-chain';
import { seedPolicyDocumentRole } from './seed-policy-document';
import { seedWorkbenchRole, seedWorkbenchEscalation } from './seed-workbench';
import { seedChecklistRole } from './seed-checklist';
import { seedConstraintFormRole, seedConstraintFormEscalations } from './seed-constraint-form';
import { seedParameterizedFormRole, seedParameterizedFormEscalations } from './seed-parameterized-form';
import { seedLookupCascadeKnowledge, seedLookupCascadeRole, seedLookupCascadeEscalations } from './seed-lookup-cascade';
import { seedPrinterFleetRoles, seedPrinterFleetEscalations } from './seed-fleet-sim';
import { seedAutoResolveDemoRoles, seedAutoResolveDemoEscalations } from './seed-auto-resolve-demo';

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
          for (const expected of userDef.roles as Array<{ role: string; type: any; read_scope?: any; write_scope?: any }>) {
            const has = currentRoles.some(r => r.role === expected.role && r.type === expected.type);
            if (!has) {
              await addUserRole(existing.id, expected.role, expected.type, {
                read_scope: expected.read_scope,
                write_scope: expected.write_scope,
              });
              loggerRegistry.info(`[examples] added role ${expected.role} (${expected.type}) to ${userDef.external_id}`);
            }
          }
        }
        // Self-heal demo bindings (e.g. the badge id): set only where the
        // user carries no metadata at all — operator values are never touched.
        const meta = (userDef as any).metadata;
        if (meta && (existing.metadata == null || Object.keys(existing.metadata).length === 0)) {
          await updateUser(existing.id, { metadata: meta });
          loggerRegistry.info(`[examples] seeded metadata bindings for ${userDef.external_id}`);
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

async function seedPersonas(): Promise<void> {
  try {
    const specs = SEED_PERSONAS.map((p) => ({
      ...p,
      // Aliases ('write-none') normalize to canonical values at the boundary.
      roles: p.roles.map((r) => ({
        role: r.role,
        relationship: r.relationship === 'write-none' ? 'read-all' as const : r.relationship,
      })),
    }));
    const result = await seedPersonaSpecs(specs);
    loggerRegistry.info(`[examples] personas verified (${result.personas} personas, ${result.links} role links)`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed personas: ${err.message}`);
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
  // The flagship entity-analytics scenario configures the printer roles first,
  // so the canonical dials and board lead every default (secondary seeders
  // respect configured roles).
  await seedPrinterFleetRoles();
  await seedPrinterFleetEscalations();
  await seedTwinRoles();
  await seedScanCodes();
  await seedBadgeScheme();
  await seedRichFormRole();
  await seedAcmeRoles();
  await seedRelatedEscalationsRoles();
  await seedTransitionChainRoles();
  await seedPolicyDocumentRole();
  await seedWorkbenchRole();
  await seedWorkbenchEscalation();
  await seedChecklistRole();
  await seedConstraintFormRole();
  await seedConstraintFormEscalations();
  await seedParameterizedFormRole();
  await seedParameterizedFormEscalations();
  await seedLookupCascadeKnowledge();
  await seedLookupCascadeRole();
  await seedLookupCascadeEscalations();
  await seedAutoResolveDemoRoles();
  await seedPersonas();
  await seedUsers();
  await seedEscalationChains();
  // Escalations born-claimed to superadmin — must run after seedUsers.
  await seedAutoResolveDemoEscalations();

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
