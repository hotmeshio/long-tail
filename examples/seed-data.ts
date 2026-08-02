import type { LTEnvelope, LTPersonaSpec } from '../types';
import type {
  ReviewContentEnvelopeData,
  KitchenSinkEnvelopeData,
  BasicEchoEnvelopeData,
  BasicSignalEnvelopeData,
  RichFormEnvelopeData,
  PolicyDocumentEnvelopeData,
} from './types';

// ── Seed users ───────────────────────────────────────────────────────────────

export const SEED_USERS = [
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
    roles: [
      { role: 'reviewer', type: 'member' as const },
      // Also holds the rich-form escalation surface so the intake demo is
      // claimable by a normal (non-superadmin) user.
      { role: 'intake-reviewer', type: 'member' as const },
      // Printer-floor membership: this user works all three printer queues,
      // sees the fleet board's default pins from first login, and is the
      // badge-scan demo associate (metadata.badge_id below).
      { role: 'printer-fleet', type: 'member' as const },
      { role: 'printer-harvest', type: 'member' as const },
      { role: 'printer-service', type: 'member' as const },
    ],
    // The badge binding the identity scan resolves: scan 11:0:BADGE-REVIEWER-7431
    // on a station device and mutations attribute to this user.
    metadata: { badge_id: 'BADGE-REVIEWER-7431' },
  },
  {
    // The shared station device: a real seat with a queue view and an audit
    // identity for reads, while write_scope 'none' keeps every mutation
    // behind the badge layer.
    external_id: 'station',
    display_name: 'Floor Station',
    email: 'station@longtail.local',
    password: 'l0ngt@1l',
    roles: [
      { role: 'printer-fleet', type: 'member' as const, read_scope: 'all' as const, write_scope: 'none' as const },
      { role: 'printer-harvest', type: 'member' as const, read_scope: 'all' as const, write_scope: 'none' as const },
      { role: 'printer-service', type: 'member' as const, read_scope: 'all' as const, write_scope: 'none' as const },
    ],
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

export const SEED_ROLES = ['reviewer', 'engineer', 'admin', 'superadmin'];

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

export type SeedWorkflowName = 'reviewContent' | 'kitchenSink' | 'basicEcho' | 'basicSignal' | 'richForm' | 'policyDocument' | 'acmeWidget' | 'transitionChain';

export const SEED_ENVELOPES: Array<{
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
        certified: true,
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
        certified: true,
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
        certified: true,
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
        certified: true,
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

  // -- Process 6: Basic Signal
  {
    label: 'Process 6 — Basic Signal',
    workflowName: 'basicSignal',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        message: 'Seed deployment needs approval before proceeding.',
        role: 'reviewer',
      } satisfies BasicSignalEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'basic-signal',
        description: 'Lightweight signal-based escalation — workflow stays running, no interceptor. Claim the escalation, fill the form, and resolve to resume the workflow.',
      },
    },
  },

  // -- Process 7: Rich Form
  {
    label: 'Process 7 — Rich Form',
    workflowName: 'richForm',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        role: 'intake-reviewer',
      } satisfies RichFormEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'rich-form',
        description: 'Showcases every HITL form feature: date pickers, email, file upload, two-column layout, required fields, and ordering.',
      },
    },
  },

  // -- Process 7b: Acme Widget (the perfect-form pair)
  {
    label: 'Process 7b — Acme Widget',
    workflowName: 'acmeWidget',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        po: 'ACME-1042',
        widgetId: 'wgt-8127',
        leftQuantity: 2,
        rightQuantity: 2,
        widgetType: 'Standard',
        sizeCode: 'S2',
        material: 'alloy',
        certified: false,
        addons: [
          { id: 'mount_front', label: 'Mount — front, left — verified on the widget' },
          { id: 'gasket_std', label: 'Gasket — standard — verified on the widget' },
        ],
      },
      metadata: {
        source: 'seed',
        process: 'acme-widget',
        description: 'The perfect-form pair: dictionary facts, one explicit Choose… decision, linear reveals, pre-checked standard checks beside clickable custom work, and the rejection report.',
      },
    },
  },

  // -- Process 8: Policy Document
  {
    label: 'Process 8 — Policy Document',
    workflowName: 'policyDocument',
    taskQueue: 'long-tail-examples',
    envelope: {
      data: {
        role: 'policy-document',
        title: 'Refund Policy',
        owner: 'Legal',
      } satisfies PolicyDocumentEnvelopeData,
      metadata: {
        source: 'seed',
        process: 'policy-document',
        description: 'One live policy at a time — the role owns a list_schema that renders the live policy as a document with a revision history.',
      },
    },
  },

  // -- Process 9: Onboarding wizard (x-lt-transition + list-driven submit-on-claim)
  // Each start puts one account into the txn-step-1 pool. The role owns a
  // list_schema whose "Start Onboarding" row action claims and submits in one
  // gesture, then transitions the person straight to the born-assigned step 2.
  ...['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson', 'Alan Turing', 'Edsger Dijkstra'].map(
    (account): { workflowName: SeedWorkflowName; taskQueue: string; envelope: LTEnvelope; label: string } => ({
      label: `Process 9 — Onboarding · ${account}`,
      workflowName: 'transitionChain',
      taskQueue: 'long-tail-examples',
      envelope: {
        data: { account },
        metadata: {
          source: 'seed',
          process: 'onboarding',
          description: 'Open the txn-step-1 list and click "Start Onboarding" — it claims, submits the account, and hands you to the preferences step.',
        },
      },
    }),
  ),
];

// Escalation chains: reviewer -> admin -> engineer (and cross-links)
export const SEED_CHAINS = [
  ['reviewer', 'admin'],
  ['reviewer', 'engineer'],
  ['admin', 'engineer'],
  ['admin', 'superadmin'],
  ['engineer', 'admin'],
  ['engineer', 'superadmin'],
];

// ── Seed personas ────────────────────────────────────────────────────────────
//
// Personas bundle the demo roles into one-step assignments. Declared the same
// way roles and default_pins are — statically, seeded idempotently — so the
// composition ("this human runs the pipeline") is a first-class record instead
// of a sequence of manual role-adds. Each role carries its own pins and
// schemas, so a persona's sidebar and forms compose from its roles with no
// persona-specific UI.
export const SEED_PERSONAS: LTPersonaSpec[] = [
  {
    key: 'production-manager',
    title: 'Production Manager',
    description:
      'Runs the pipeline: works design and review, watches print and the machine fleet.',
    roles: [
      { role: 'design', relationship: 'write-all' },
      { role: 'review', relationship: 'write-all' },
      { role: 'print', relationship: 'read-all' },
      { role: 'printer-fleet', relationship: 'read-all' },
    ],
  },
  {
    key: 'fleet-operator',
    title: 'Fleet Operator',
    description: 'Services the machine fleet and watches the print queue feeding it.',
    roles: [
      { role: 'printer-fleet', relationship: 'write-all' },
      { role: 'printer-harvest', relationship: 'write-all' },
      { role: 'printer-service', relationship: 'write-all' },
      { role: 'print', relationship: 'read-all' },
    ],
  },
];
