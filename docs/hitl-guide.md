# Human-in-the-Loop (HITL)

Build durable workflows that pause for human input and resume automatically when the human responds. Long-tail handles the full escalation lifecycle — claiming, routing, forms, resolution — so you focus on business logic and form design.

---

## Design Philosophy: The Form Is Data

The escalation is the unit of UI. The **role** decides who sees it, the **schema** decides what they see, the **version** decides which edition renders, and the **scope** decides how much of the queue is theirs. An escalation can be handled by any member of its role — a person working the dashboard or a service account resolving through the API — the role is the contract, not the kind of actor behind it. A workflow that assigns an escalation to a named user with a self-scoped membership produces a just-in-time form, scoped by RBAC — one person, one item, one versioned surface — without a line of frontend code.

This works because the form is data: a JSON Schema stored on the role, versioned in `lt_role_schemas`, snapshotted immutably on every edit, and pinnable per escalation. A schema-driven form is auditable (which edition did the resolver see?), validated by the platform (required, bounds, patterns, conditionals), and rendered consistently. The iframe viewport is the escape hatch for domains that need a fully custom surface — a WebGL editor, a PDF workbench — and it trades all of those platform guarantees for total control. Reach for the schema first; reach for the iframe when the domain demands it.

### Choosing Your Surface

| You need | Use | Doc |
|----------|-----|-----|
| Typed fields, formats, required | Plain JSON Schema | [form.md](hitl/form.md) |
| Input guards (bounds, patterns, dynamic limits) | Validation keywords | [x-lt-validation.md](hitl/x-lt-validation.md) |
| Fields that appear based on another answer | `x-lt-showIf` | [x-lt-show-if.md](hitl/x-lt-show-if.md) |
| Sections, columns, ordering, side-panel help | Layout keywords | [x-lt-layout.md](hitl/x-lt-layout.md) |
| Runtime-driven items, files, signatures, SOP blocks | Widgets | [x-lt-widget.md](hitl/x-lt-widget.md) |
| A role-authored list page for the whole queue | List schema | [x-lt-list-schema.md](hitl/x-lt-list-schema.md) |
| A fully custom UI nothing above can express | Iframe viewport | [iframe.md](hitl/iframe.md) |

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
2. **Platform routes** — the escalation appears in the queue of every member of the matching role: people see it in the dashboard, service accounts act on it through the API or MCP tools
3. **Member claims** — a role member claims the work item (soft-lock with TTL)
4. **Member submits** — the form response is sent back as a signal to the paused workflow
5. **Workflow resumes** — continues execution with the resolver payload

---

## What Long-tail Provides

When you author a HITL-backed workflow, the platform handles:

- **Escalation routing** — role-based, priority-ordered work queues
- **Claim/release** — soft-lock with TTL; an extend prompt before expiry, a locked form after, and a resolve guard that rejects stale claims (see [resolution.md](hitl/resolution.md#claim-lifecycle))
- **Real-time updates** — NATS/Socket.IO events push changes to the dashboard instantly
- **Form rendering** — JSON Schema to rich form controls, no frontend code needed
- **Draft persistence** — form edits are saved locally per escalation and restored on return; cleared on submit or cancel
- **Accessible forms** — generated controls carry label association, error announcements, and keyboard-correct locking (see [form.md](hitl/form.md#accessibility))
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

Ordered as a learning path — each file adds one capability to the same form:

| Topic | File |
|-------|------|
| Creating escalations with `conditionLT`, schema versioning | [escalation.md](hitl/escalation.md) |
| Field types, formats, required, read-only | [form.md](hitl/form.md) |
| Pre-submission validation guards (min, max, pattern, dynamic bounds) | [x-lt-validation.md](hitl/x-lt-validation.md) |
| Conditional visibility (`x-lt-showIf`, `x-lt-hide-if-empty`) | [x-lt-show-if.md](hitl/x-lt-show-if.md) |
| Layout, ordering, sections, binding, help panel | [x-lt-layout.md](hitl/x-lt-layout.md) |
| Custom widgets (checklist, file upload, code editor, signature, markdown) | [x-lt-widget.md](hitl/x-lt-widget.md) |
| List schema (`active-history`, `facet-table`) | [x-lt-list-schema.md](hitl/x-lt-list-schema.md) |
| Iframe viewport protocol | [iframe.md](hitl/iframe.md) |
| Claim lifecycle, resolving from system code, outcome recording, cancellation | [resolution.md](hitl/resolution.md) |
| Role routing, RBAC, scope, chains | [roles.md](hitl/roles.md) |
| Pinned views, user preferences, role default pins | [pinned-views.md](hitl/pinned-views.md) |

---

## Full Vocabulary Quick Reference

| Keyword | Level | Purpose |
|---------|-------|---------|
| `x-lt-widget` | field | Rich control: `file-upload`, `code-editor`, `signature`, `rich-text`, `markdown`, `checklist`, `attachment` (alias `image`) |
| `x-lt-source` | field | Data path for context-driven widgets: `"domain.path"` |
| `x-lt-require-all` | field | Checklist completion guard — every item must be checked, except items declared `required: false` |
| `x-lt-language` | field | Syntax hint for the `code-editor` widget |
| `accept` | field | File-type filter for `file-upload` (e.g. `".pdf,.png"`) |
| `x-lt-bind` | field | Path in the resolver payload (e.g. `"customer.email"`) |
| `x-lt-span` | field | Column span in a `two-column` layout (`2` = full width) |
| `x-lt-showIf` | field | Show field when a value is truthy at `domain.path`; prefix `!` to invert; `=VALUE` / `!=VALUE` compare the string form |
| `x-lt-hide-if-empty` | field | `true` — suppress the field when its value is null, `""`, `false`, or `0` |
| `x-lt-section` | field | Section group label |
| `x-lt-minimum` | field | Dynamic lower bound — resolves a `"domain.path"` from the escalation context |
| `x-lt-maximum` | field | Dynamic upper bound — resolves a `"domain.path"` from the escalation context |
| `x-lt-min-length` | field | Dynamic minimum string length — resolves a `"domain.path"` |
| `x-lt-max-length` | field | Dynamic maximum string length — resolves a `"domain.path"` |
| `x-lt-pattern-error` | field | Human-readable label for a `pattern` validation failure |
| `x-lt-order` | schema | Field render sequence |
| `x-lt-layout` | schema | `"two-column"` grid layout (form) or `"active-history"` / `"facet-table"` / `"facet-board"` (list) |
| `x-lt-group-by` | schema (list) | `facet-board`: the `"domain.path"` identifying each entity |
| `x-lt-card` | schema (list) | `facet-board`: per-entity card — `{ title, state?, fields? }`; fields accept `format: "age"` |
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
