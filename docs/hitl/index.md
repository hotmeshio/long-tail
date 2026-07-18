# Human-in-the-Loop (HITL)

Build durable workflows that pause for human input and resume automatically when the human responds. Long-tail handles the full escalation lifecycle — claiming, routing, forms, resolution — so you focus on business logic and form design.

---

## Architecture

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

## What Long-tail Provides

When you author a HITL-backed workflow, the platform handles:

- **Escalation routing** — role-based, priority-ordered work queues
- **Claim/release** — soft-lock with TTL, prevents duplicate work
- **Real-time updates** — NATS/Socket.IO events push changes to the dashboard instantly
- **Form rendering** — JSON Schema to rich form controls, no frontend code needed
- **Side panel** — help, AI analysis, metadata, context, and raw-record views beside the form
- **Section state persistence** — collapsed sections remembered across navigation
- **Escalation chains** — users can re-route work to other roles
- **AI triage** — optional auto-resolution for common patterns
- **Credential security** — password fields use ephemeral tokens, never stored in plain text
- **Telemetry** — trace IDs link escalations to OpenTelemetry traces
- **Bulk operations** — bulk claim, assign, escalate, triage, and cancel for queue management
- **Cancellation** — cancel pending escalations from the API or dashboard

You write the workflow and the schema. Everything else is provided.

---

## Section Map

| Topic | File |
|-------|------|
| Creating escalations with `conditionLT`, schema versioning | [escalation.md](escalation.md) |
| Field types, formats, required, read-only | [form.md](form.md) |
| Custom widgets (checklist, file upload, code editor, signature, markdown) | [x-lt-widget.md](x-lt-widget.md) |
| Conditional visibility (`x-lt-showIf`, `x-lt-hide-if-empty`) | [x-lt-show-if.md](x-lt-show-if.md) |
| Pre-submission validation guards (min, max, pattern, dynamic bounds) | [x-lt-validation.md](x-lt-validation.md) |
| Layout, ordering, sections, binding, help panel | [x-lt-layout.md](x-lt-layout.md) |
| List schema (`active-history`, `facet-table`) | [x-lt-list-schema.md](x-lt-list-schema.md) |
| Iframe viewport protocol | [iframe.md](iframe.md) |
| Resolving from system code, outcome recording, cancellation | [resolution.md](resolution.md) |

---

## Full Vocabulary Quick Reference

| Keyword | Level | Purpose |
|---------|-------|---------|
| `x-lt-widget` | field | Rich control: `file-upload`, `code-editor`, `signature`, `rich-text`, `markdown`, `checklist` |
| `x-lt-source` | field | Data path for context-driven widgets: `"domain.path"` |
| `x-lt-language` | field | Syntax hint for the `code-editor` widget |
| `accept` | field | File-type filter for `file-upload` (e.g. `".pdf,.png"`) |
| `x-lt-bind` | field | Path in the resolver payload (e.g. `"customer.email"`) |
| `x-lt-span` | field | Column span in a `two-column` layout (`2` = full width) |
| `x-lt-showIf` | field | Show field when a value is truthy at `domain.path`; prefix `!` to invert |
| `x-lt-hide-if-empty` | field | `true` — suppress the field when its value is null, `""`, `false`, or `0` |
| `x-lt-section` | field | Section group label |
| `x-lt-minimum` | field | Dynamic lower bound — resolves a `"domain.path"` from the escalation context |
| `x-lt-maximum` | field | Dynamic upper bound — resolves a `"domain.path"` from the escalation context |
| `x-lt-min-length` | field | Dynamic minimum string length — resolves a `"domain.path"` |
| `x-lt-max-length` | field | Dynamic maximum string length — resolves a `"domain.path"` |
| `x-lt-pattern-error` | field | Human-readable label for a `pattern` validation failure |
| `x-lt-order` | schema | Field render sequence |
| `x-lt-layout` | schema | `"two-column"` grid layout (form) or `"active-history"` / `"facet-table"` (list) |
| `x-lt-help` | schema | Markdown guidance for the side panel's Help view |
| `x-lt-context` | schema | Plain-text fallback for the Help view when `x-lt-help` is absent |
| `x-lt-viewport` | schema | Replace the generated form with a custom iframe UI |
| `x-lt-columns` | schema (list) | Column definitions for `facet-table` layout |
| `x-lt-active` | schema (list) | Active-item card definition |
| `x-lt-history` | schema (list) | History column definition |
| `format` | field | Input specialization: `password`, `date`, `date-time`, `email`, `uri`, `textarea` |
| `readOnly` | field | Static display |
| `required` | schema | Fields that block submission when empty |
| `title` / `description` | both | Form section header / helper text |
| `minimum` / `maximum` | field | Static numeric bounds — enforced before submission |
| `exclusiveMinimum` / `exclusiveMaximum` | field | Exclusive numeric bounds |
| `minLength` / `maxLength` | field | Static string length bounds |
| `pattern` | field | Regexp guard — enforced before submission |
