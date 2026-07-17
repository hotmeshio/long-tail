# Human-in-the-Loop (HITL) Guide

Build durable workflows that pause for human input and resume automatically when the human responds. Long-tail provides the full escalation lifecycle — claiming, routing, forms, resolution — so you focus on business logic and form design.

---

## Architecture Overview

```
Durable Workflow                  Long-tail Platform              Dashboard
┌─────────────┐                  ┌──────────────────┐            ┌──────────────┐
│ Run logic   │                  │  Create record   │            │  List view   │
│ Hit decision│──escalate───────>│  Route to role   │───event──> │  Detail page │
│ point       │                  │  Persist schema  │            │  Render form │
│ ...pause... │                  │                  │            │  Human edits │
│             │<──signal─────────│  Signal workflow │<──submit── │  Submit      │
│ Resume with │                  │  Mark resolved   │            │              │
│ payload     │                  └──────────────────┘            └──────────────┘
└─────────────┘
```

1. **Workflow escalates** — creates an escalation record with a role, description, and optional form schema
2. **Platform routes** — the escalation appears in the dashboard for users with the matching role
3. **Human claims** — a user claims the work item (soft-lock with TTL)
4. **Human submits** — the form response is sent back as a signal to the paused workflow
5. **Workflow resumes** — continues execution with the human's input as the resolver payload

---

## Creating Escalations

### Pattern 1: `conditionLT` Signal (Recommended)

The workflow stays running and waits for a signal. Lightweight, no re-run needed. Two forms — prefer the atomic one.

#### Atomic form (recommended)

Pass an escalation config to `conditionLT`. The escalation row is written inside the workflow's Leg1 checkpoint — one commit, crash-safe: no separate create activity, no enrich step. `signal_key` is the resume key, so the dashboard resolve endpoint and `POST /escalations/resolve-by-signal-key` both resume *this* job in place, and `system.escalation.{id}.created` fires automatically.

```typescript
import { conditionLT } from '@hotmeshio/long-tail';

export async function approvalWorkflow(envelope: LTEnvelope) {
  const ctx = Durable.workflow.workflowInfo();
  const signalId = `approval-${ctx.workflowId}`;

  // One atomic expression: write the escalation in Leg1, then pause.
  const decision = await conditionLT<{ approved: boolean; notes?: string }>(signalId, {
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
    // SLA timer fired first — the row is already status='expired' (engine-side,
    // atomic) and a late resolve returns already-expired. Branch to fallback.
    return { type: 'return' as const, data: { autoRejected: 'sla' } };
  }
  if (decision === null) {
    // escalation was cancelled (workflow terminated or explicit cancel)
    return { type: 'return' as const, data: { cancelled: true } };
  }

  if (decision.approved) {
    // ... proceed with approved flow ...
  } else {
    // ... handle rejection ...
  }
}
```

The `timeout` field makes the wait SLA-gated in the same single Leg1 write:
one `conditionLT` call yields the worklist row AND the resume timer. Omit it
for an open-ended wait.

Two engine contracts worth building on:

- **The row is complete from its first visible moment.** Every field of the
  config — including `metadata` facets — commits inside the Leg1 checkpoint.
  A claim-by-metadata router or a version-pinned facet (e.g. a
  `schema_version` the resolver UI renders) can trust every row it reads;
  there is no window where a row is visible but its metadata is still en route.
- **Early signals are buffered.** A resolve that races ahead of the
  `condition()` registration (a fast webhook, a payload deposited before the
  workflow starts) is held as a pending signal and delivered when the wait
  registers — 10 minutes by default; pass `expire` to `signal()` (e.g. `'1h'`)
  when signaling early on purpose. Fan-out (`Promise.all` over many waits)
  scales the same way: buffering covers every signal that outruns its
  registration.

#### Two-step form

When you need to create the escalation separately — for example to enrich routing metadata before pausing — create it first, then wait:

```typescript
import { conditionLT } from 'long-tail/orchestrator';
import { ltCreateEscalation } from 'long-tail/activities';

export async function approvalWorkflow(envelope: LTEnvelope) {
  // ... do initial work ...

  const signalId = `approval-${ctx.workflowId}`;

  // Create the escalation with a form schema
  await ltCreateEscalation({
    type: 'approval',
    subtype: 'budget-request',
    description: `Budget approval needed: $${envelope.amount}`,
    role: 'finance-reviewer',
    priority: 2,
    envelope: JSON.stringify(envelope),
    workflowId: ctx.workflowId,
    taskQueue: ctx.taskQueue,
    workflowType: 'approvalWorkflow',
    metadata: {
      signal_id: signalId,
      form_schema: {
        title: 'Budget Approval',
        description: 'Review the budget request and approve or reject.',
        properties: {
          approved: { type: 'boolean', description: 'Approve this request?' },
          notes: { type: 'string', format: 'textarea', description: 'Optional reviewer notes' },
        },
        required: ['approved'],
      },
    },
  });

  // Workflow pauses here until the human responds
  const decision = await conditionLT<{ approved: boolean; notes?: string }>(signalId);

  if (!decision) {
    // null = cancelled, false = timeout
    return { type: 'return' as const, data: { cancelled: true } };
  }

  if (decision.approved) {
    // ... proceed with approved flow ...
  } else {
    // ... handle rejection ...
  }
}
```

### Pattern 2: Interceptor Return

The workflow returns an escalation result. The interceptor handles creation. On resolution, the workflow is re-run with the resolver payload injected into the envelope.

```typescript
export async function reviewWorkflow(envelope: LTEnvelope) {
  if (needsHumanReview(envelope)) {
    return {
      type: 'escalation',
      data: { document: envelope.documentUrl },
      message: 'Document requires human review before publishing',
      priority: 2,
      role: 'content-reviewer',
    };
  }
  // ... normal flow ...
}
```

### Which Schema Renders the Form

The resolver form resolves in order, most specific first:

1. **`metadata.form_schema`** — a full JSON Schema embedded on the escalation row. Use when different escalation points in the same workflow need different forms.
2. **The role's `form_schema`** — the versioned form every role provides. When the row carries a `metadata.schema_version` pin (set via `schemaVersion` in the `conditionLT` config), the form renders exactly that snapshot even after the role's schema changes; without a pin, the role's latest applies.
3. **Workflow config `resolver_schema`** — **deprecated** legacy fallback only, used when no role `form_schema` is available.

### Versioned Role Schemas

Every save that changes a role's `form_schema` or `metadata_schema` appends an immutable snapshot to the version history (`lt_role_schemas`) and advances the role's current version. Escalations that need a guaranteed shape pin one:

```typescript
const decision = await conditionLT<{ approved: boolean; lotNumber: string }>(signalId, {
  role: 'reviewer',
  description: instructions,
  schemaVersion: 3,   // this row renders role schema v3, always
});
```

The pin travels as `metadata.schema_version` on the row (GIN-indexed, queryable like any facet). A pin that names a missing version fails at creation with a 400 — it never falls through to a different version. Without a pin, the role's latest schema always applies: workflow authors who don't care get the current form automatically; authors who depend on a specific field (say, a form that gained `lotNumber` in v3 and the workflow reads it back) pin the version and the round trip stays aligned.

`metadata.schema_version` also selects which `metadata_schema` validates the creation-time metadata bag on `POST /api/escalations`.

Inspect versions via `GET /api/roles/:role/schema?version=N`, `GET /api/roles/:role/schema/versions`, `lt.roles.getSchema` / `lt.roles.listSchemaVersions`, `ltc roles schema <role> --version N`, or the `get_role_schema` / `list_role_schema_versions` admin MCP tools. Save a new version by writing only the schema — `PATCH /api/roles/:role` with `form_schema` (+ optional `change_summary`), `lt.roles.update`, `ltc roles save-schema <role> --file schema.json`, or the `update_role` MCP tool. The dashboard edits it on the role's Escalation Schema page (`/admin/roles/:role/schema`), with the version history and snapshot viewer alongside.

---

## Recording the Outcome on Resolution

An escalation row is created carrying **intent** — what was asked, who it routed to. Resolving it can stamp the **outcome** onto the same row: every resolve surface takes an optional `metadata` patch, merged into the row's GIN-indexed metadata.

| Surface | How to pass it |
|---------|----------------|
| HTTP | `metadata` in the resolve body (`POST /api/escalations/:id/resolve`, `/resolve-by-signal-key`) |
| SDK facade | `lt.escalations.resolve({ id, resolverPayload, metadata })` |
| MCP | `metadata` arg on `claim_and_resolve` / `resolve_escalation` |
| In-process library | `resolveEscalation(id, payload, metadata)` / `resolveEscalationBySignalKey(signalKey, payload, metadata)` |

```typescript
await lt.escalations.resolve({
  id,
  resolverPayload: { approved: true },               // resumes the workflow; not indexed
  metadata: { outcome: 'approved', reviewedBy: 'alice', durationMs: elapsed },
});
```

The patch is distinct from the resolver payload: the payload resumes the paused workflow and is not indexed; the metadata patch is the durable, queryable record on the row. Use it for the audit trail and analytics — disposition, reviewer, time-to-resolve — so the escalation table answers *what was asked, what was decided, and how long it took* without a parallel log.

### Resolving a set atomically

When one decision settles a SET of waits — each with its own payload — use
`lt.escalations.resolveAllOrNone({ items })` (`POST /api/escalations/resolve-all-or-none`).
Every listed row resolves with its own `resolverPayload` in one SQL statement,
waking each parked workflow with its own value, or nothing resolves and the
409 body names exactly the rows that blocked (`failedIds` + reasons). Pass
`requireClaimed: true` in claim-then-resolve flows to assert, inside the same
statement, that every row is still assigned to the caller. See the
[SDK reference](./api/sdk/escalations.md#resolveallornone) for the full contract.

---

## JSON Schema Form Authoring

The dashboard renders forms automatically from JSON Schema. No frontend code needed.

The full custom vocabulary at a glance — every `x-lt-*` keyword and extension key the renderer honors:

| Keyword | Level | Purpose |
|---------|-------|---------|
| `x-lt-widget` | field | Rich control: `file-upload`, `code-editor`, `signature`, `rich-text`, `markdown` |
| `x-lt-language` | field | Syntax hint shown by the `code-editor` widget |
| `accept` | field | File-type filter for the `file-upload` widget (e.g. `".pdf,.png"`) |
| `x-lt-bind` | field | Path this field's value occupies in the resolver payload (e.g. `"customer.email"`) |
| `x-lt-span` | field | Column span in a `two-column` layout (`2` = full width) |
| `x-lt-showIf` | field | Show field only when a value exists at `domain.path`; prefix `!` to invert |
| `x-lt-order` | schema | Field render sequence |
| `x-lt-layout` | schema | `"two-column"` grid layout |
| `x-lt-help` | schema | Markdown guidance for the side panel's Help view; `{{domain.path}}` tokens interpolate live record values |
| `x-lt-context` | schema | Plain-text fallback for the Help view when `x-lt-help` is absent |
| `x-lt-viewport` | schema | Replace the generated form with a custom iframe UI |
| `format` | field | Input specialization: `password`, `date`, `date-time`, `email`, `uri`, `textarea` |
| `readOnly` | field | Static display (or a rendered content block with the `markdown` widget) |
| `required` | schema | Fields that must be filled before submit |
| `title` / `description` | both | Section header / helper text |

The working reference is `examples/workflows/rich-form/` — the `intake-reviewer` role's
versioned `form_schema` (seeded by `examples/seed-rich-form.ts`) exercises the whole
vocabulary in one form: side-panel help (`x-lt-help` with a checklist, table, tokens,
and a relative link), two-column layout, ordering, date and email formats, enum, file
upload, spans, required fields, and `x-lt-bind` mapping into a nested payload.

### Supported Field Types

| JSON Type | Renders As |
|-----------|-----------|
| `boolean` | Checkbox toggle |
| `number` | Number input |
| `string` | Text input (default) |
| `string` + `enum` | Dropdown select |
| `null` | Read-only "null" display |
| `array` | Tag display (read-only) |
| `object` | Nested section with recursive fields |

### String Format Extensions

Use the `format` keyword to get specialized inputs:

| Format | Input Type |
|--------|-----------|
| `"password"` | Password field (masked, with ephemeral token redaction) |
| `"date"` | Date picker |
| `"date-time"` | Date + time picker |
| `"email"` | Email input with validation |
| `"uri"` | URL input |
| `"textarea"` | Multi-line textarea (always, regardless of content length) |

```json
{
  "properties": {
    "due_date": { "type": "string", "format": "date" },
    "contact_email": { "type": "string", "format": "email" },
    "detailed_notes": { "type": "string", "format": "textarea" }
  }
}
```

### Custom Widgets (`x-lt-widget`)

For rich inputs beyond standard HTML types:

| Widget | Description |
|--------|------------|
| `"file-upload"` | File picker with drag-and-drop. Stores base64 data URL. Use `accept` to filter file types. |
| `"code-editor"` | Monospace textarea with tab-key support. Use `x-lt-language` for syntax hint. |
| `"signature"` | HTML5 Canvas drawing pad. Outputs PNG data URL. |
| `"rich-text"` | Tall textarea for formatted text input. |
| `"markdown"` | Markdown source, rendered with the same engine as the docs drawer (headings, tables, lists, code blocks, callouts). Editable fields get a Write/Preview toggle; with `readOnly: true` the field is a pure content block — see below. |

```json
{
  "properties": {
    "screenshot": {
      "type": "string",
      "x-lt-widget": "file-upload",
      "accept": "image/*",
      "description": "Upload a screenshot of the issue"
    },
    "fix_script": {
      "type": "string",
      "x-lt-widget": "code-editor",
      "x-lt-language": "sql",
      "description": "SQL migration to apply"
    },
    "signature": {
      "type": "string",
      "x-lt-widget": "signature",
      "description": "Sign to confirm"
    }
  }
}
```

#### Markdown content blocks

`readOnly: true` + `x-lt-widget: "markdown"` turns a field into a rendered content
block: the markdown in its `default` displays as HTML inside the form — headings,
tables, checklists, callouts. The versioned schema carries the page source itself,
so review instructions and SOPs version with the form they belong to, and the
source rides along in the resolver payload like any read-only field.

```json
{
  "properties": {
    "review_guide": {
      "type": "string",
      "readOnly": true,
      "x-lt-widget": "markdown",
      "x-lt-span": 2,
      "default": "### Review checklist\n\n1. Confirm the **legal name** matches.\n2. Send a test message before approving.\n\n> Escalate non-standard contract language to legal."
    }
  }
}
```

Without `readOnly`, the field is a markdown *editor* — the resolver writes source in
a Write/Preview toggle and the submitted value is the markdown text.

### Help Panel (`x-lt-help`)

Schema-level `x-lt-help` carries the form's guidance — checklists, tier tables,
callouts, links — as markdown. The dashboard renders it in the side panel beside the
form, so the form itself stays a clean title and fields while the SOP sits one glance
to the right. The help versions with the form: it lives in the same `form_schema`
snapshot in `lt_role_schemas`.

```json
{
  "title": "Customer Intake",
  "x-lt-help": "### Review checklist\n\n1. Confirm the **legal name** matches.\n2. Send a test message before approving.\n\nThis escalation is **{{escalation.status}}** in the **{{escalation.role}}** queue.\n\n[Back to the queue](/escalations/queue?role=intake-reviewer)",
  "properties": { ... }
}
```

`{{domain.path}}` tokens interpolate live values from the escalation surface using the
`x-lt-bind` path syntax (dot keys, optional `[n]` indices). Five domains are available:

| Domain | Resolves against |
|--------|------------------|
| `escalation` | The escalation row (`{{escalation.role}}`, `{{escalation.status}}`) |
| `metadata` | The row's metadata dict (`{{metadata.schema_version}}`) |
| `envelope` | The workflow-sent input envelope (`{{envelope.formDefaults.customer.name}}`) |
| `payload` | The escalation context payload (`{{payload.category}}`) |
| `resolver` | The submitted resolver payload (`{{resolver.notes}}`) |

A missing value renders as an em dash. Links whose href starts with `/` navigate
inside the dashboard.

The Help view falls back in order: `x-lt-help` → `x-lt-context` (plain text) → a
state-aware hint ("Claim this escalation to enable the form", "Fill out the form and
submit to resolve it", and so on), so the panel always tells the resolver what the
page expects of them. The panel's other views surface the record itself: **Metadata**
(the row's metadata values), **Context** (input envelope, escalation context, resolver
payload), and **Record** (the raw escalation JSON, builders only).

### Payload Binding (`x-lt-bind`)

The form is flat; the payload the workflow consumes rarely is. A field may declare
`x-lt-bind` — the path its value occupies in the resolver payload (dot keys, optional
`[n]` indices). The dashboard maps the flat form through the binds on submit, and
reverse-maps workflow-seeded `envelope.formDefaults` through them to prefill. A field
with no bind lands at its own name at the payload root (1:1).

```json
{
  "properties": {
    "customer_name": { "type": "string", "x-lt-bind": "customer.name" },
    "contact_email": { "type": "string", "format": "email", "x-lt-bind": "customer.email" },
    "tier": { "type": "string", "enum": ["starter", "professional"], "x-lt-bind": "contract.tier" },
    "notes": { "type": "string", "format": "textarea" }
  }
}
```

Submitting `{ customer_name, contact_email, tier, notes }` stores:

```json
{
  "customer": { "name": "…", "email": "…" },
  "contract": { "tier": "…" },
  "notes": "…"
}
```

Only the FORM is versioned on the role — the payload shape is the workflow's own
contract, produced by the binds. Evolve the form and its binds together, and the
workflow's resolver type in the same commit.

### Layout Options (`x-lt-layout`)

Control how fields are arranged:

| Layout | Behavior |
|--------|----------|
| `"two-column"` | Fields in a 2-column grid. Use `x-lt-span: 2` on a field for full-width. |

```json
{
  "x-lt-layout": "two-column",
  "properties": {
    "first_name": { "type": "string" },
    "last_name": { "type": "string" },
    "notes": { "type": "string", "format": "textarea", "x-lt-span": 2 }
  }
}
```

### Field Ordering (`x-lt-order`)

By default, fields render in JSON key order. Use `x-lt-order` to control sequence:

```json
{
  "x-lt-order": ["priority", "decision", "notes"],
  "properties": {
    "notes": { "type": "string" },
    "decision": { "type": "string", "enum": ["approve", "reject", "defer"] },
    "priority": { "type": "number" }
  }
}
```

### Conditional Visibility (`x-lt-showIf`)

A field can be hidden or shown based on a value present in the escalation record. Use `x-lt-showIf` on any property to make it conditional:

```json
"x-lt-showIf": "domain.path"
```

The value at `domain.path` is evaluated for truthiness. If it is present and truthy the field shows; if absent, null, false, or an empty string it is hidden. Prefix `!` to invert: show when the value is absent.

Domains follow the same `domain.path` convention as `x-lt-help` tokens:

| Domain | Resolves against |
|--------|-----------------|
| `metadata` | The row's metadata dict |
| `payload` | The escalation context payload (`escalation_payload`) |
| `envelope` | The workflow-sent input envelope |
| `escalation` | Top-level escalation row fields (`role`, `status`, `priority`, …) |
| `resolver` | The submitted resolver payload |

**Example — item type branching:**

A role where the queue receives both regular work items and crew-pill shutdown signals. The payload carries `item_type` to distinguish them.

```json
{
  "title": "Worker Station",
  "properties": {
    "action_taken": {
      "type": "string",
      "enum": ["completed", "deferred", "escalated"],
      "description": "Outcome for this work item",
      "x-lt-showIf": "!payload.crew_pill"
    },
    "notes": {
      "type": "string",
      "format": "textarea",
      "x-lt-showIf": "!payload.crew_pill"
    },
    "shutdown_ack": {
      "type": "boolean",
      "title": "Acknowledge shutdown",
      "description": "Confirm you are stopping work and clearing the station",
      "x-lt-showIf": "payload.crew_pill"
    }
  }
}
```

When `escalation_payload` contains `{ "crew_pill": true }`, only `shutdown_ack` renders. When the payload carries a regular item (no `crew_pill` key), only `action_taken` and `notes` render.

`x-lt-showIf` is evaluated against the escalation record at render time — not against the current form values. Hidden fields are not rendered but their values (if any) remain in the form state and are not submitted to the resolver payload via `x-lt-bind` unless they were filled.

### Validation (`required`)

Fields listed in `required` show a red asterisk and block submission when empty:

```json
{
  "required": ["decision"],
  "properties": {
    "decision": { "type": "string", "enum": ["approve", "reject"] },
    "notes": { "type": "string", "description": "Optional comments" }
  }
}
```

### Read-Only Fields (`readOnly`)

Fields with `readOnly: true` display as static text. Useful for showing context alongside editable fields:

```json
{
  "properties": {
    "request_amount": { "type": "number", "readOnly": true },
    "approved_amount": { "type": "number", "description": "Enter the approved amount" }
  }
}
```

### Schema Title and Description

The `title` and `description` at the schema root are used in the UI:
- **`title`**: Shown as the form's section header
- **`description`**: Shown as helper text beneath the title — keep it to a short phrase; longer guidance belongs in `x-lt-help`
- **`x-lt-help`**: Rendered as markdown in the side panel beside the form

```json
{
  "title": "Expense Approval",
  "description": "Review the expense report below. Verify receipts match the claimed amounts. Approve or reject with notes.",
  "properties": { ... }
}
```

---

## Iframe Viewport Protocol

For fully custom UIs (PDF viewers, complex multi-step forms, specialized domain UIs), use an iframe viewport.

### Schema Declaration

```json
{
  "x-lt-viewport": {
    "type": "iframe",
    "src": "https://your-app.example.com/hitl-form"
  },
  "properties": { ... }
}
```

When `x-lt-viewport` is present, the dashboard renders an iframe instead of the standard form.

### Message Protocol

Communication happens via `window.postMessage`.

#### Parent to Iframe

```typescript
// Sent when the iframe signals ready or on load
{
  type: 'lt:init',
  escalation: {
    id: string,
    type: string,
    subtype: string,
    description: string | null,
    status: string,
    priority: number,
    role: string,
    workflow_type: string | null,
  },
  schema: Record<string, unknown>,  // The full form schema
}

// Optional: parent requests the iframe to submit
{
  type: 'lt:requestSubmit'
}
```

#### Iframe to Parent

```typescript
// Signal that the iframe is ready to receive init data
{ type: 'lt:ready' }

// Submit the human's response — triggers escalation resolution
{ type: 'lt:submit', payload: { approved: true, notes: '...' } }

// Escalate to a different role
{ type: 'lt:escalate', target: 'senior-reviewer' }

// Auto-resize the iframe
{ type: 'lt:resize', height: 600 }
```

### Minimal Example

```html
<!DOCTYPE html>
<html>
<head><title>Custom HITL Form</title></head>
<body>
  <div id="form"></div>
  <button id="submit">Approve</button>

  <script>
    // Signal ready
    window.parent.postMessage({ type: 'lt:ready' }, '*');

    // Receive init data
    window.addEventListener('message', (event) => {
      if (event.data.type === 'lt:init') {
        const { escalation, schema } = event.data;
        document.getElementById('form').textContent =
          `Reviewing: ${escalation.description}`;
      }
    });

    // Submit response
    document.getElementById('submit').addEventListener('click', () => {
      window.parent.postMessage({
        type: 'lt:submit',
        payload: { approved: true, reviewed_at: new Date().toISOString() },
      }, '*');
    });
  </script>
</body>
</html>
```

### Security

- The iframe runs with `sandbox="allow-scripts allow-same-origin allow-forms"`
- The parent validates message origins — only messages from the iframe's origin are accepted
- The `envelope` field (which may contain secrets) is NOT sent to the iframe
- Only safe escalation metadata (id, type, description, status, priority, role) is exposed

---

## The Escalation Detail Page

The escalation detail page has one view, built for the person resolving the item: the
escalation's description is the page title, the form starts directly beneath it, and
the action bar closes the page. The lifecycle sparkline (waiting / claimed / resolved
ratios) sits as a short persistent row above the side panel. Everything else lives in
the side panel, ordered by specificity:

| View | Shows | Available to |
|------|-------|--------------|
| **Help** | The form's `x-lt-help` markdown, or a state-aware hint | Everyone |
| **Details** | Status, role, priority, claim provenance, timestamps; identifier links below a divider | Everyone (identifiers: builders) |
| **AI Analysis** | What triage diagnosed and corrected | When AI is enabled and triage data is present |
| **Metadata** | The row's metadata values | Everyone |
| **Context** | Input envelope, escalation context, resolver payload | Everyone |
| **Record** | The raw escalation JSON | Builders (admins, superadmins, engineers) |

The page is two fixed-height columns beneath the global toolbar — the form column and
the panel each scroll independently, so the panel stays pinned like the left nav while
long forms or long panel content scroll. The form column narrows as the panel expands
(the panel is capped at half the page). When the form carries `x-lt-help`, the panel
opens expanded on the Help view; otherwise it stays hidden until the page-header panel
button summons it.

### Designing the Form

To create a polished resolve experience:

1. Set `title` on your schema — it replaces the section header
2. Set `x-lt-help` — checklists, tables, and links render as markdown in the side panel, with `{{domain.path}}` tokens for live record values; keep `description` to a short subtitle
3. Use `readOnly` fields for context the human needs to see but shouldn't edit
4. Use `x-lt-order` to put the most important fields first
5. Use `required` to guide users on what must be filled
6. Use descriptive `description` on individual fields for inline help text

---

## Escalations List Schema

The form schema formats one escalation on the detail page. A role can also own a
`list_schema` that formats its whole **list** page — the list-page analog of the
resolve form. It is opt-in and applies only when the list is scoped to exactly one
role (`/escalations/available?role=<role>`). Absent, the list renders the standard
engineer table; present, a rich role-authored view renders with a "Table view" toggle
one click away. It is versioned **independently** of the form schema (its own timeline;
a list edit never bumps the form version) and edited on its own page,
`/admin/roles/:role/list-schema`. The list always renders the latest version.

This is what turns a queue like a `policy-document` role — where a looped workflow
keeps exactly one escalation live and each resolved one is a revision — into a document
with a history, instead of a one-row table.

### Vocabulary

Every string is a markdown/text template run through the same `{{domain.path}}` token
binding as `x-lt-help` (domains `escalation | metadata | envelope | payload | resolver`,
evaluated against each row); `body` strings render through the markdown renderer.

| Key | Level | Purpose |
|-----|-------|---------|
| `x-lt-layout` | schema | `"active-history"` (two columns), `"active"` (card only), or `"table"` (fallback) |
| `x-lt-help` | schema | Optional markdown header, interpolated with the active row |
| `x-lt-active` | schema | The live item card: `{ title, subtitle?, body?, fields?: [{label, value}] }` |
| `x-lt-history` | schema | History column: `{ row: { title, subtitle?, meta? }, limit?, status? }` |

The **active** item is the first non-terminal escalation. The **history** column is not
auto-loaded — a "Load full history" link fetches resolved items on demand (`status`
defaults to `resolved`, `limit` to 25). Unknown/absent `x-lt-layout` is a safe no-op
that falls back to the table.

### Example — a policy-document role

```json
{
  "x-lt-layout": "active-history",
  "x-lt-help": "# {{metadata.title}}\nThe authoritative policy. One revision is live at a time.",
  "x-lt-active": {
    "title": "{{metadata.title}}",
    "subtitle": "Revision {{metadata.revision}} · effective {{metadata.effective_date}}",
    "body": "{{metadata.document_markdown}}",
    "fields": [
      { "label": "Owner", "value": "{{metadata.owner}}" },
      { "label": "Claimed by", "value": "{{escalation.assigned_to}}" }
    ]
  },
  "x-lt-history": {
    "row": { "title": "{{metadata.title}} — revision {{metadata.revision}}" },
    "limit": 25
  }
}
```

The working reference is `examples/workflows/policy-document/` (role seeded by
`examples/seed-policy-document.ts`): a looped workflow opens one policy-review
escalation, parks on it, and folds each resolution into the next revision — so the
policy facts ride the row's metadata and the list view reads them with `{{metadata.*}}`.

---

## Role-Based Routing

Escalations are routed by role. Users only see escalations for roles they hold.

```typescript
// Workflow escalates to a specific role
await ltCreateEscalation({
  role: 'finance-reviewer',  // Only users with this role see it
  // ...
});
```

### Work-Surface Scope

A `member` of a role carries a work-surface scope that narrows what they see and act on within that queue: `read_scope` (`self` | `all`) governs which escalations they see, and `write_scope` (`none` | `self` | `all`) governs which they can claim, resolve, or cancel. `self` means escalations assigned to that member (`assigned_to = user`); `all` means the whole role queue. `admin` and `superadmin` always work the whole queue. See the [Roles API](api/http/roles.md#work-surface-scope) for the five member profiles and the assignment contract.

Scope is a property of the **membership** (`lt_user_roles`), not of the escalation. The escalation engine is unchanged: `condition()` / `conditionLT()`, `ltCreateEscalation`, and the interceptor write escalation rows (`hmsh_escalations`) exactly as before — an escalation carries a `role` and an optional `assigned_to`, with no scope column. Scope is resolved at read time, when a *user* lists or acts on the queue. Escalating to a role that does not exist yet still registers the role name only — roles are typeless; `type` and scope are set per user when the role is granted. The one place scope affects creation is the standalone `POST /api/escalations` HTTP endpoint, which requires `write_scope=all`; workflow-emitted escalations (`conditionLT`, interceptor returns, `ltCreateEscalation`) do not pass through that check.

### One-Time and Pre-Assigned Users

To route a single item to a named person, assign the escalation to them and provision them with `read_scope=self` + `write_scope=self`. The workflow sets `assigned_to` to the person's user ID (a pre-claim) when it creates the escalation, then provisions or updates that user as a `member` with self/self scope on the target role. They land directly on that one item — a just-in-time form scoped by RBAC, with no access to the rest of the queue and no direct table access. An update or follow-up is simply another workflow firing another escalation to that same person.

```typescript
// Pre-assign the escalation to a specific person and route a one-time form to them
await ltCreateEscalation({
  role: 'customer-triage',
  assigned_to: userId,        // pre-claim — durable, keyed off the user, not the soft-lock TTL
  description: 'Confirm your shipping address',
  metadata: {
    form_schema: {
      title: 'Confirm Address',
      properties: { address: { type: 'string' }, confirmed: { type: 'boolean' } },
      required: ['confirmed'],
    },
  },
});
// The person is provisioned as a member of `customer-triage` with read_scope=self, write_scope=self.
```

### Escalation Chains

Users can escalate to other roles via the "Escalate" tab:

```
Analyst → Senior Analyst → Manager → VP
```

Configure escalation targets in the role configuration (Admin > Roles). Each role defines which other roles it can escalate to.

### Multi-Tier Example

```typescript
// Level 1: Auto-review
const result = await autoReview(document);

if (result.confidence < 0.8) {
  // Level 2: Human analyst
  await ltCreateEscalation({
    role: 'analyst',
    description: `Low confidence review (${result.confidence})`,
    metadata: {
      form_schema: {
        title: 'Document Review',
        properties: {
          approved: { type: 'boolean' },
          corrections: { type: 'string', format: 'textarea' },
        },
        required: ['approved'],
      },
    },
  });
  // User can further escalate to 'senior-analyst' or 'manager' from the dashboard
}
```

---

## Worked Examples

### Simple Approval

A workflow needs a yes/no decision with optional notes.

```typescript
metadata: {
  signal_id: signalId,
  form_schema: {
    title: 'Approve Request',
    description: 'Review the details and approve or reject this request.',
    required: ['approved'],
    properties: {
      approved: { type: 'boolean', description: 'Check to approve' },
      notes: { type: 'string', format: 'textarea', description: 'Optional comments' },
    },
  },
}
```

### Document Review with PDF Viewer

Use an iframe viewport to embed a PDF viewer alongside approval controls.

```typescript
metadata: {
  signal_id: signalId,
  form_schema: {
    title: 'Document Review',
    'x-lt-viewport': {
      type: 'iframe',
      src: 'https://internal.example.com/pdf-reviewer',
    },
  },
}
```

The iframe at `pdf-reviewer` loads the document, renders it with a viewer, and posts `lt:submit` with the review decision.

### Multi-Field Data Entry

A complex form with layout and validation.

```typescript
metadata: {
  signal_id: signalId,
  form_schema: {
    title: 'Customer Intake',
    description: 'Complete the customer information form. All required fields must be filled before submission.',
    'x-lt-layout': 'two-column',
    'x-lt-order': ['first_name', 'last_name', 'email', 'phone', 'tier', 'notes'],
    required: ['first_name', 'last_name', 'email', 'tier'],
    properties: {
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string' },
      tier: {
        type: 'string',
        enum: ['free', 'pro', 'enterprise'],
        description: 'Select the customer tier',
      },
      notes: {
        type: 'string',
        format: 'textarea',
        'x-lt-span': 2,
        description: 'Additional notes about this customer',
      },
    },
  },
}
```

### Credential Provisioning

Password fields are automatically redacted and replaced with ephemeral tokens (15-min TTL) before being sent back to the workflow.

```typescript
metadata: {
  signal_id: signalId,
  form_schema: {
    title: 'Provide Credentials',
    description: 'Enter the API credentials for this integration. Passwords are encrypted and stored as ephemeral tokens.',
    required: ['api_key', 'api_secret'],
    properties: {
      api_key: { type: 'string', description: 'API Key' },
      api_secret: { type: 'string', format: 'password', description: 'API Secret (will be redacted)' },
      environment: {
        type: 'string',
        enum: ['sandbox', 'production'],
        description: 'Target environment',
      },
    },
  },
}
```

---

## Resolving from System Code

When a backend service (not the dashboard UI) needs to resolve an escalation — for example, an ingress handler that receives a webhook or processes a domain event — use the escalation SDK methods directly.

### By escalation ID

Use when you already have the escalation UUID (e.g. stored in your own DB alongside the order):

```typescript
const result = await lt.escalations.resolve({
  id: escalationId,
  resolverPayload: { approved: true, targetStatus: 'ready' },
});
```

This routes through the full resolution path and works for all escalation types — atomic `conditionLT` (signal_key), legacy `conditionLT` (signal_id), and re-run-style escalations.

### By metadata key-value pair

Use when you know a domain identifier (e.g. `orderId`) but not the escalation UUID. `resolveByMetadata` finds the highest-priority pending escalation matching the key-value pair and resolves it atomically — no pre-flight lookup, no TOCTOU:

```typescript
const result = await lt.escalations.resolveByMetadata({
  key: 'orderId',
  value: orderId,
  resolverPayload: { approved: true, targetStatus: 'ready' },
});

if (result.status === 404) {
  // No pending escalation for this orderId
}
```

This works for all escalation types including atomic `conditionLT` rows (those with `signal_key` set). The routing is transparent — the caller does not need to know which pattern the workflow used.

### By signal key

When the signal key is deterministic and known to the caller (e.g. `station-done-${workflowId}`), use the direct signal-key path to skip the metadata lookup:

```typescript
await lt.escalations.resolveBySignalKey({
  signalKey: `station-done-${workflowId}`,
  resolverPayload: { approved: true },
});
```

---

## Cancelling Escalations

Escalations can be cancelled at any point before they are resolved. Cancellation is terminal — a cancelled escalation cannot be re-opened.

### When cancellation happens

- **Workflow termination** — when you terminate a workflow (`POST /api/workflows/:workflowId/terminate`), HotMesh automatically cancels any pending escalations tied to it. The waiting `conditionLT` call returns `null`.
- **Explicit cancel** — cancel a single escalation via the API or from the dashboard. Any workflow waiting on that escalation via `conditionLT` receives `null`.

### API

```
POST /api/escalations/:id/cancel        # single escalation
POST /api/escalations/bulk-cancel       # { "ids": [...] }
```

Returns 409 if the escalation is already resolved or cancelled.

### Dashboard

- **Available escalations list** — select one or more rows and click **Cancel** in the bulk action bar. A confirmation modal appears before any action is taken.
- **Escalation detail page** — a Cancel link appears in the action bar when the escalation is in `available` or `claimed_by_me` state. Terminal escalations (resolved or cancelled) show no cancel affordance.

### Handling cancellation in workflows

`conditionLT` returns `T | false | null`. Always guard before accessing the payload:

```typescript
const decision = await conditionLT<{ approved: boolean }>(signalId, escalationConfig);

if (decision === null) {
  // Escalation was cancelled (workflow terminated or explicit cancel)
  return { type: 'return' as const, data: { cancelled: true } };
}
if (decision === false) {
  // Escalation timed out
  return { type: 'return' as const, data: { timedOut: true } };
}

// Normal path — decision is the resolver's payload
```

The `!decision` shorthand handles both cases when you don't need to distinguish between them:

```typescript
if (!decision) {
  return { type: 'return' as const, data: { cancelled: true } };
}
```

---

## What Long-tail Provides (For Free)

When you author a HITL-backed workflow, the platform handles:

- **Escalation routing** — role-based, priority-ordered work queues
- **Claim/release** — soft-lock with TTL, prevents duplicate work
- **Real-time updates** — NATS/Socket.IO events push changes to the dashboard instantly
- **Form rendering** — JSON Schema to rich form controls, no frontend code needed
- **Side panel** — help, AI analysis, metadata, context, and raw-record views beside the form
- **Section state persistence** — collapsed sections remembered across navigation
- **Escalation chains** — users can re-route work to other roles
- **AI triage** — optional auto-resolution for common patterns
- **Signal routing** — 5 resolution paths (conditionLT, waitFor, triage, re-run, notification-only)
- **Credential security** — password fields use ephemeral tokens, never stored in plain text
- **Telemetry** — trace IDs link escalations to OpenTelemetry traces
- **Bulk operations** — bulk claim, assign, escalate, triage, and cancel for queue management
- **Cancellation** — cancel pending escalations from the API or dashboard; `conditionLT` returns `null` so workflows handle it cleanly

You write the workflow and the schema. Everything else is provided.
