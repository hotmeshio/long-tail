# Creating Escalations

## `conditional` — Atomic Pattern

Pass an escalation config to `conditional`. The escalation row, its metadata, and the resume timer all commit inside the workflow's Leg1 checkpoint — one write, crash-safe. The `signal_key` on the row is the resume key: the dashboard resolve endpoint and `POST /api/escalations/resolve-by-signal-key` both resume this job in place, and the `system.escalation.{role}.{id}.created` event fires automatically.

> `conditionLT` is a deprecated alias of `conditional`. Existing code continues to work.

```typescript
import { conditional } from '@hotmeshio/long-tail';

export async function approvalWorkflow(envelope: LTEnvelope) {
  const ctx = Durable.workflow.workflowInfo();
  const signalId = `approval-${ctx.workflowId}`;

  const decision = await conditional<{ approved: boolean; notes?: string }>(signalId, {
    role: 'finance-reviewer',
    type: 'approval',
    subtype: 'budget-request',
    priority: 2,
    description: `Budget approval needed: $${envelope.data.amount}`,
    metadata: {
      form_schema: {
        title: 'Budget Approval',
        properties: {
          approved: { type: 'boolean', description: 'Approve this request?' },
          notes: { type: 'string', format: 'textarea' },
        },
        required: ['approved'],
      },
    },
    envelope: { data: envelope.data },
    timeout: '72h',   // SLA: resume with false + expire the row if unresolved
  });

  if (decision === false) {
    // SLA timer fired — the row is already status='expired', any late resolve returns already-expired
    return { type: 'return' as const, data: { autoRejected: 'sla' } };
  }
  if (decision === null) {
    // Escalation was cancelled (workflow terminated or explicit cancel)
    return { type: 'return' as const, data: { cancelled: true } };
  }

  if (decision.approved) {
    // ... approved flow ...
  } else {
    // ... rejection flow ...
  }
}
```

`conditional` returns `T | false | null`:
- `T` — the human's resolver payload
- `false` — SLA timeout (omit `timeout` for an open-ended wait)
- `null` — cancellation (workflow terminated or explicit cancel)

### Resolution provenance — `$resolution`

Interactive and webhook resolves deliver the resolver's identity alongside the payload under the reserved `$resolution` key. Declare it in the generic to consume it — the standard pattern for assigning follow-on work to whoever resolved:

```typescript
import type { EscalationResolution } from '@hotmeshio/long-tail';

const decision = await conditional<{
  approved: boolean;
  $resolution?: EscalationResolution;
}>(signalId, { role: 'order-reviewer', metadata: { orderId } });

if (decision && decision.$resolution) {
  const { escalationId, resolvedBy, resolvedByEmail } = decision.$resolution;
  // e.g. claim the follow-on rows for the same person, atomically:
  // POST /api/escalations/bulk-assign { query: {...}, targetUserId: resolvedBy }
}
```

`$resolution` carries `escalationId`, `resolvedBy` (user id), and `resolvedByEmail` when known. It rides the signal only — the stored `resolver_payload` audit column receives the form payload untouched. The same resolve also merges `resolved_by` into the row's GIN-indexed `metadata`, so "who resolved it" is `@>`-queryable without a follow-up read. The `$`-prefixed key namespace is reserved for control data; consumer form fields never collide with it.

### Batch accumulation — one escalation, N contributions

Declare `batch` item keys and the escalation becomes an accumulator: it resolves only when every declared item has been submitted, and the wait resumes with the full collection. Interim submissions are cheap atomic row fills — the workflow never wakes per item, and the collation happens at the escalation boundary.

```typescript
const parts = await conditional<Record<'cut' | 'weld' | 'paint', StationResultV1>>(signalId, {
  role: 'assembly',
  description: 'Each station submits its result',
  metadata: { orderId },
  batch: ['cut', 'weld', 'paint'],
  timeout: '24h',   // one SLA covers the whole collection
});
if (parts === false) { /* expired — partially filled items remain on the row for audit */ }
if (parts === null) { /* cancelled */ }
parts.weld; // typed item payload
```

The declaration folds into the row at creation, inside the same Leg1 commit:

- `metadata.batch_pending` — item keys still awaiting submission (`@>`-queryable: `{"batch_pending":["weld"]}` finds rows still missing `weld`)
- `metadata.batch_count` — the remaining count, recomputed from `batch_pending` on every fill
- `metadata.batch_keys` — the immutable declared list (progress = `batch_keys` minus `batch_pending`)
- `envelope.batch_items` — the accumulated `Record<itemKey, payload>` map (payloads are plumbing, so they live on the unindexed envelope; payload keys are caller-owned)
- `envelope.batch_filled_at` — `Record<itemKey, iso8601>`, stamped by the database clock inside each fill statement — the collection timeline as row truth

Items are submitted via `POST /api/escalations/:id/resolve-batch-item`, `POST /api/escalations/resolve-batch-item-by-signal-key` (the deterministic home signal id — no UUID lookup, no facet duplication), or `POST /api/escalations/resolve-batch-item-by-metadata` (see [Resolution — Batch items](resolution.md)). Each item validates against the same versioned role form a single-item resolver gets, `schemaVersion` pins included. Each fill is one guarded statement: the payload lands only while its key is still pending (duplicates return `duplicate-item` untouched), and the LAST fill resolves the row, stores the assembled collection as `resolver_payload`, and wakes this wait — atomically. The completing submission's `$resolution` rides the delivered collection.

`timeout` and cancellation keep their standard semantics (`false` / `null`); a plain resolve on a batch row remains an admin override that resolves the whole row with the payload given.

### Row completeness guarantee

Every field of the config — including all `metadata` facets — commits inside the Leg1 checkpoint. A claim-by-metadata router or a version-pinned facet reads a complete row from its first visible moment; there is no window where a row is visible but its metadata is still en route.

### Early-signal buffering

A resolve that races ahead of the `conditional` registration (a fast webhook, or a payload deposited before the workflow starts) is held as a pending signal and delivered when the wait registers — 10 minutes by default; pass `expire` to `signal()` when signaling early on purpose. Fan-out (`Promise.all` over many waits) scales the same way.

---

## Versioned Role Schemas

Every role carries a versioned `form_schema`. Every save that changes it appends an immutable snapshot to `lt_role_schemas` and advances the role's current version. Escalations pin one with `schemaVersion`:

```typescript
const decision = await conditional<{ approved: boolean; lotNumber: string }>(signalId, {
  role: 'reviewer',
  description: instructions,
  schemaVersion: 3,   // renders role schema v3, always, regardless of later edits
});
```

The pin travels as `metadata.schema_version` on the row (GIN-indexed, queryable like any facet). A pin that names a missing version fails at creation with a 400 — it never silently falls through to a different version. Without a pin, the role's latest schema always applies.

Inspect versions:
- `GET /api/roles/:role/schema?version=N`
- `GET /api/roles/:role/schema/versions`
- `lt.roles.getSchema` / `lt.roles.listSchemaVersions`
- `ltc roles schema <role> --version N`
- `get_role_schema` / `list_role_schema_versions` admin MCP tools
- Dashboard: `/admin/roles/:role/schema`

Save a new version: `PATCH /api/roles/:role` with `form_schema` (+ optional `change_summary`), `lt.roles.update`, `ltc roles save-schema <role> --file schema.json`, the `update_role` MCP tool, or the dashboard schema editor.

---

## Form Schema Resolution

The resolver form uses the most specific schema available for each escalation row:

1. **`metadata.form_schema`** — a full JSON Schema embedded on the row. Use when different escalation points in the same workflow need different forms.
2. **The role's versioned `form_schema`** — when `metadata.schema_version` is set, the snapshot at that version renders; otherwise the role's latest applies.

---

## Working Examples

The reference examples ship as fully runnable seeds:

- `examples/workflows/rich-form/` — `intake-reviewer` role: two-column layout, ordering, date and email formats, enum, file upload, spans, required fields, `x-lt-bind`, `x-lt-help`
- `examples/workflows/checklist-confirmation/` — `checklist-operator` role: checklist widget with `x-lt-source` driving dynamic items from the envelope
- `examples/workflows/constraint-form/` — `quality-reviewer` role: the reference for all pre-submission guards — hidden required field, dynamic checklist, min/max, pattern, dynamic numeric and string-length bounds

### Simple approval

```typescript
import { conditional } from '@hotmeshio/long-tail';

export async function approveSpendWorkflow(envelope: LTEnvelope) {
  const ctx = Durable.workflow.workflowInfo();

  const decision = await conditional<{ approved: boolean; notes?: string }>(
    `spend-approval-${ctx.workflowId}`,
    {
      role: 'finance-reviewer',
      type: 'approval',
      description: `Approve spend of $${envelope.data.amount} for ${envelope.data.vendor}`,
      priority: 2,
      metadata: {
        form_schema: {
          title: 'Spend Approval',
          description: 'Review and approve or reject this spend request.',
          required: ['approved'],
          properties: {
            approved: { type: 'boolean', description: 'Check to approve' },
            notes: { type: 'string', format: 'textarea', description: 'Optional comments' },
          },
        },
      },
      timeout: '48h',
    },
  );

  if (decision === null) return { type: 'return' as const, data: { cancelled: true } };
  if (decision === false) return { type: 'return' as const, data: { timedOut: true } };

  if (decision.approved) {
    await releasePayment(envelope.data);
  } else {
    await notifyRejection(envelope.data, decision.notes);
  }
}
```

### Checklist confirmation

Dynamic checklist where item labels come from the workflow's envelope, not the static schema. Item count and wording vary per escalation without touching the form schema.

```typescript
import { conditional } from '@hotmeshio/long-tail';

export async function stationCheckWorkflow(envelope: LTEnvelope) {
  const ctx = Durable.workflow.workflowInfo();

  const steps = [
    { id: 'step_0', label: 'Verify patient ID matches the order' },
    { id: 'step_1', label: 'Confirm dosage and route of administration' },
    { id: 'step_2', label: 'Sign the dispensing log' },
  ];

  const result = await conditional<{ checks: Record<string, boolean> }>(
    `station-check-${ctx.workflowId}`,
    {
      role: 'station-operator',
      type: 'station-check',
      description: 'Complete all station checks before releasing',
      priority: 1,
      envelope: {
        checklist_items: steps,
        formDefaults: {
          checks: Object.fromEntries(steps.map((s) => [s.id, false])),
        },
      },
      metadata: {
        form_schema: {
          title: 'Station Check',
          description: 'Work through each step and confirm completion.',
          required: ['checks'],
          properties: {
            checks: {
              type: 'object',
              'x-lt-widget': 'checklist',
              'x-lt-source': 'envelope.checklist_items',
              description: 'Check each step when complete',
            },
          },
        },
      },
    },
  );

  if (!result) return { type: 'return' as const, data: { cancelled: true } };

  const allClear = Object.values(result.checks).every(Boolean);
  const failed = steps.filter((s) => !result.checks[s.id]).map((s) => s.label);

  if (!allClear) {
    await flagIncomplete({ failed });
  }
}
```
