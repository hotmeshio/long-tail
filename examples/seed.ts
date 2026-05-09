import { Durable } from '@hotmeshio/hotmesh';

import { JOB_EXPIRE_SECS } from '../modules/defaults';
import { loggerRegistry } from '../lib/logger';
import { getPool } from '../lib/db';
import { getUserByExternalId, createUser } from '../services/user';
import { addUserRole, getUserRoles } from '../services/user/roles';
import { addEscalationChain, createRole } from '../services/role';
import { SEED_USERS, SEED_ROLES, SEED_ENVELOPES, SEED_CHAINS } from './seed-data';

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
async function seedExampleConfigs(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    INSERT INTO lt_config_workflows
      (workflow_type, task_queue, default_role, invocable, description, tool_tags, envelope_schema, resolver_schema)
    VALUES
      ('reviewContent', 'long-tail-examples', 'reviewer', true,
       'Content review — AI-powered moderation with human escalation for low-confidence results',
       ARRAY['document-processing', 'vision', 'ocr', 'translation'],
       '{"data": {"contentId": "article-001", "content": "Content to review...", "contentType": "article"}, "metadata": {"source": "dashboard"}}'::jsonb,
       '{"approved": true, "analysis": {"confidence": 0.95, "flags": [], "summary": "Manually reviewed and approved."}}'::jsonb),
      ('verifyDocument', 'long-tail-examples', 'reviewer', true,
       'Document verification — AI Vision analyzes identity documents',
       ARRAY['document-processing', 'vision', 'ocr', 'translation'],
       '{"data": {"documentId": "doc-001", "documentUrl": "https://example.com/doc.jpg", "documentType": "drivers_license", "memberId": "member-12345"}, "metadata": {"source": "dashboard"}}'::jsonb,
       '{"memberId": "", "extractedInfo": {}, "validationResult": "match", "confidence": 1.0}'::jsonb),
      ('processClaim', 'long-tail-examples', 'reviewer', true,
       'Insurance claim processing — document analysis, validation, and human review',
       ARRAY['document-processing', 'vision', 'database', 'query'],
       '{"data": {"claimId": "CLM-2024-001", "claimantId": "POL-5551234", "claimType": "auto_collision", "amount": 12500, "documents": ["incident_report.pdf", "photo_evidence.jpg"]}, "metadata": {"source": "dashboard"}}'::jsonb,
       '{"approved": true, "analysis": {"confidence": 0.92, "flags": [], "summary": "Documents reviewed and verified."}, "status": "resolved"}'::jsonb),
      ('kitchenSink', 'long-tail-examples', 'reviewer', true,
       'Kitchen sink — demonstrates sleep, signals, parallel activities, escalation, and every durable primitive',
       '{}',
       '{"data": {"name": "World", "mode": "full"}, "metadata": {"source": "dashboard"}}'::jsonb,
       NULL),
      ('basicSignal', 'long-tail-examples', 'reviewer', true,
       'Signal-based escalation — workflow stays running while waiting for human input via conditionLT',
       '{}',
       '{"data": {"message": "Deployment approval needed for v2.1.0", "role": "reviewer"}, "metadata": {"certified": false, "source": "dashboard"}}'::jsonb,
       '{"properties": {"approved": {"type": "boolean", "default": false, "description": "Approve this deployment?"}, "notes": {"type": "string", "default": "", "description": "Reviewer notes — visible to the workflow author"}}}'::jsonb)
    ON CONFLICT (workflow_type) DO NOTHING
  `);

  // Assign roles to example workflows
  await pool.query(`
    INSERT INTO lt_config_roles (workflow_type, role)
    SELECT workflow_type, unnest(ARRAY['reviewer', 'engineer', 'admin'])
    FROM lt_config_workflows
    WHERE workflow_type IN ('reviewContent', 'verifyDocument', 'processClaim', 'kitchenSink')
    ON CONFLICT (workflow_type, role) DO NOTHING
  `);

  loggerRegistry.info('[examples] workflow configs seeded');
}

/**
 * Seed example workflows so the dashboard tells a story immediately.
 * Called automatically when `examples: true` is set in the start config.
 */
export async function seedExamples(client: any): Promise<void> {
  await seedExampleConfigs();
  await seedRoles();
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
      } as any);
      loggerRegistry.info(`[examples] seeded: ${label} (${workflowId})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] seed failed for ${label}: ${err.message}`);
    }
  }
}
