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

The workflow stays running and waits for a signal. Lightweight, no re-run needed.

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

  if (decision.approved) {
    // ... proceed with approved flow ...
  } else {
    // ... handle rejection ...
  }
}
```

### Pattern 2: Signal Queue (Recommended)

The workflow creates an `lt_escalations` record with `metadata.signal_queue: true`, then calls `conditionLT(signalId, queueConfig)`. The engine suspends the workflow and inserts a `hotmesh_signals` row in a single atomic transaction. When the escalation is resolved, `lt.escalations.resolve()` detects `signal_queue: true` and calls `client.signalQueue.resolve()` — which marks the signal entry resolved and delivers the payload to the paused workflow atomically.

```typescript
import { conditionLT } from '@hotmeshio/long-tail';
import type { ConditionQueueConfig } from '@hotmeshio/long-tail';

export async function approvalWorkflow(envelope: LTEnvelope) {
  const ctx = Durable.workflow.workflowInfo();
  const signalId = `approval-${ctx.workflowId}`;

  await activities.createApprovalEscalation({
    workflowId: ctx.workflowId,
    taskQueue: ctx.taskQueue,
    workflowType: 'approvalWorkflow',
    signalId,
    metadata: {
      signal_id: signalId,
      signal_queue: true,
      form_schema: {
        title: 'Budget Approval',
        required: ['approved'],
        properties: {
          approved: { type: 'boolean', description: 'Approve this request?' },
          notes: { type: 'string', format: 'textarea' },
        },
      },
    },
  });

  const decision = await conditionLT<{ approved: boolean; notes?: string }>(signalId, {
    role: 'finance-reviewer',
    type: 'approval',
    subtype: 'budget-request',
    priority: 2,
    description: `Budget approval: $${envelope.data.amount}`,
    taskQueue: ctx.taskQueue,
    workflowType: 'approvalWorkflow',
    metadata: { requestId: envelope.data.requestId },
  });

  if (decision.approved) {
    // proceed
  }
}
```

See the [Signal Queue guide](../signal-queue.md) for architecture details, `lt.signalQueue.*` operations, and `tryResolveByMetadata` for defensive programmatic resolution.

### Pattern 3: Interceptor Return

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

### Per-Escalation vs Workflow-Level Schema

- **Workflow config `resolver_schema`**: Default form for all escalations of this workflow type. Set in the workflow registry.
- **`metadata.form_schema`**: Per-escalation override. Takes precedence over workflow config. Use when different escalation points in the same workflow need different forms.

---

## JSON Schema Form Authoring

The dashboard renders forms automatically from JSON Schema. No frontend code needed.

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
- **`title`**: Shown as the section header (replaces "Submit Your Resolution" in user mode)
- **`description`** or **`x-lt-context`**: In user mode, displayed as a context panel alongside the form in a two-panel layout

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

## Dev Mode vs User Mode

The escalation detail page has two viewing modes:

| Aspect | Dev Mode | User Mode |
|--------|----------|-----------|
| **Default for** | Admins, superadmins, engineers | All other roles |
| **Shows** | Everything | Title, description, form, action bar |
| **Hides** | Nothing | Technical IDs, raw JSON, envelope data, AI triage, raw JSON editor |
| **Persistence** | sessionStorage (per browser session) | sessionStorage |

**Key principle**: User mode only hides technical debugging information. All HITL workflow actions (claim, submit, escalate, release) are always visible in both modes.

Privileged users can toggle between modes via the switch in the page header.

### Designing for User Mode

To create a polished user mode experience:

1. Set `title` on your schema — it replaces the section header
2. Set `description` or `x-lt-context` — it appears as a context panel in a two-panel layout
3. Use `readOnly` fields for context the human needs to see but shouldn't edit
4. Use `x-lt-order` to put the most important fields first
5. Use `required` to guide users on what must be filled
6. Use descriptive `description` on individual fields for inline help text

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

## What Long-tail Provides (For Free)

When you author a HITL-backed workflow, the platform handles:

- **Escalation routing** — role-based, priority-ordered work queues
- **Claim/release** — soft-lock with TTL, prevents duplicate work
- **Real-time updates** — NATS/Socket.IO events push changes to the dashboard instantly
- **Form rendering** — JSON Schema to rich form controls, no frontend code needed
- **Dev/user mode** — technical vs clean views, per-session preference
- **Section state persistence** — collapsed sections remembered across navigation
- **Escalation chains** — users can re-route work to other roles
- **AI triage** — optional auto-resolution for common patterns (dev mode)
- **Signal routing** — 5 resolution paths (conditionLT, waitFor, triage, re-run, notification-only)
- **Credential security** — password fields use ephemeral tokens, never stored in plain text
- **Telemetry** — trace IDs link escalations to OpenTelemetry traces
- **Bulk operations** — bulk claim, assign, escalate, triage for queue management

You write the workflow and the schema. Everything else is provided.
