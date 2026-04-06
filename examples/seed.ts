import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../types';
import type {
  ReviewContentEnvelopeData,
  KitchenSinkEnvelopeData,
  BasicEchoEnvelopeData,
} from './types';
import { JOB_EXPIRE_SECS } from '../modules/defaults';
import { loggerRegistry } from '../services/logger';
import { getUserByExternalId, createUser } from '../services/user';
import { addUserRole, getUserRoles } from '../services/user/roles';
import { addEscalationChain, createRole } from '../services/role';

// ── Seed users ───────────────────────────────────────────────────────────────

const SEED_USERS = [
  {
    external_id: 'superadmin',
    display_name: 'Super Admin',
    email: 'admin@longtail.local',
    password: 'l0ngt@1l',
    roles: [{ role: 'superadmin', type: 'superadmin' as const }],
  },
  {
    external_id: 'admin',
    display_name: 'Admin User',
    email: 'admin-user@longtail.local',
    password: 'l0ngt@1l',
    roles: [{ role: 'admin', type: 'admin' as const }],
  },
  {
    external_id: 'engineer',
    display_name: 'Engineer User',
    email: 'engineer@longtail.local',
    password: 'l0ngt@1l',
    roles: [{ role: 'engineer', type: 'member' as const }],
  },
  {
    external_id: 'reviewer',
    display_name: 'Reviewer User',
    email: 'reviewer@longtail.local',
    password: 'l0ngt@1l',
    roles: [{ role: 'reviewer', type: 'member' as const }],
  },
  {
    external_id: 'mock:test-user-1',
    display_name: 'Alice Test',
    email: 'alice@test.local',
    password: 'l0ngt@1l',
    oauth_provider: 'mock',
    oauth_provider_id: 'test-user-1',
    roles: [{ role: 'superadmin', type: 'superadmin' as const }],
  },
];

const SEED_ROLES = ['reviewer', 'engineer', 'admin', 'superadmin'];

// ── Seed processes ───────────────────────────────────────────────────────────
//
// Five processes that tell the LongTail story. Each workflow is invocable
// directly -- no orchestrator wrappers needed.
//
// Process 1 -- "Clean Review"
//   Content passes AI analysis. Auto-approved. The happy path.
//
// Process 2 -- "Flagged for Review"
//   Content triggers REVIEW_ME flag. AI escalates to reviewer role.
//
// Process 3 -- "Wrong Language -> Durable MCP"
//   Content arrives in Spanish. AI flags low confidence -> escalates.
//   Walk the escalation chain: reviewer -> admin -> engineer.
//   As engineer, check "Request AI Triage" to trigger MCP remediation.
//
// Process 4 -- "Dynamic Triage (Kitchen Sink)"
//   Kitchen-sink workflow creates a standard escalation.
//   As reviewer, check "Request AI Triage" to trigger dynamic triage.
//
// Process 5 -- "Basic Echo"
//   Minimal durable workflow -- echoes a message and reveals IAM context.

type SeedWorkflowName = 'reviewContent' | 'kitchenSink' | 'basicEcho';

const SEED_ENVELOPES: Array<{
  workflowName: SeedWorkflowName;
  taskQueue: string;
  envelope: LTEnvelope;
  label: string;
}> = [
  // -- Process 1: Clean Review
  {
    label: 'Process 1 — Clean Review',
    workflowName: 'reviewContent',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        contentId: 'process-clean-001',
        content: 'This is a well-researched article about renewable energy solutions for urban environments. It covers solar panels, wind turbines, and energy storage with thorough citations and balanced analysis.',
        contentType: 'article',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'clean-review',
        description: 'Happy path — AI auto-approves high-quality content',
      },
    },
  },

  // -- Process 2: Flagged for Review
  {
    label: 'Process 2 — Flagged for Review',
    workflowName: 'reviewContent',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        contentId: 'process-flagged-001',
        content: 'REVIEW_ME This user-submitted blog post discusses alternative medicine claims without citing peer-reviewed sources. The AI flagged it for human review.',
        contentType: 'blog_post',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'flagged-review',
        description: 'AI flags content for human review. Log in as reviewer (reviewer/l0ngt@1l) and approve or reject.',
      },
    },
  },

  // -- Process 3: Wrong Language -> Durable MCP
  {
    label: 'Process 3 — Wrong Language',
    workflowName: 'reviewContent',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        contentId: 'process-language-001',
        content: 'WRONG_LANGUAGE La energía renovable es el futuro de las ciudades sostenibles. Los paneles solares y las turbinas eólicas pueden reducir significativamente la huella de carbono urbana cuando se combinan con sistemas modernos de almacenamiento de energía.',
        contentType: 'article',
      } satisfies ReviewContentEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'wrong-language',
        description: 'Content arrived in the wrong language. Walk the escalation chain: reviewer → admin → engineer. As engineer, check "Request AI Triage" and describe: "Content is in Spanish, needs translation to English."',
      },
    },
  },

  // -- Process 4: Kitchen Sink -> Dynamic Triage
  {
    label: 'Process 4 — Dynamic Triage',
    workflowName: 'kitchenSink',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        name: 'Triage Demo',
        mode: 'full',
      } satisfies KitchenSinkEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'dynamic-triage',
        description: 'As reviewer, check "Request AI Triage" and write: "This looks fine, just approve it."',
      },
    },
  },

  // -- Process 5: Basic Echo
  {
    label: 'Process 5 — Basic Echo',
    workflowName: 'basicEcho',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        message: 'Hello from the seed!',
        sleepSeconds: 2,
      } satisfies BasicEchoEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'basic-echo',
        description: 'Minimal durable workflow — echoes a message and reveals IAM context.',
      },
    },
  },
];

// Escalation chains: reviewer -> admin -> engineer (and cross-links)
const SEED_CHAINS = [
  ['reviewer', 'admin'],
  ['reviewer', 'engineer'],
  ['admin', 'engineer'],
  ['admin', 'superadmin'],
  ['engineer', 'admin'],
  ['engineer', 'superadmin'],
];

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
 * Seed example workflows so the dashboard tells a story immediately.
 * Called automatically when `examples: true` is set in the start config.
 */
export async function seedExamples(client: any): Promise<void> {
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
