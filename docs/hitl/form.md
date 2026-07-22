# Form Fields

The dashboard renders forms automatically from JSON Schema. No frontend code needed.

---

## Field Labels

A field's label resolves in order:

1. The `title` keyword — the author's explicit label, always wins.
2. Snake/kebab keys title-cased: `left_quantity` → `Left Quantity`. All-caps tokens inside a key keep their casing (`po_number` → `Po Number`, `PO_number` → `PO Number`).
3. Single-token keys pass through unchanged: `PO`, `SKU`, `LEFTQUANTITY`.

Declare `title` on every field whose key isn't already a readable label — it is the difference between `LEFTQUANTITY` and `Left Quantity` everywhere the field faces a human: the form, the dictionary display, and the errors panel.

```json
{
  "properties": {
    "LEFTQUANTITY": { "type": "number", "title": "Left Quantity" }
  }
}
```

---

## Field Types

| JSON Type | Renders As |
|-----------|-----------|
| `boolean` | Checkbox toggle |
| `number` | Number input |
| `string` | Text input (default) |
| `string` + `enum` | Dropdown select |
| `null` | Read-only "null" display |
| `array` | Tag display (read-only) |
| `object` | Nested section with recursive fields, or a widget (see [x-lt-widget.md](x-lt-widget.md)) |

---

## String Format Extensions

Use `format` on any `string` field to get a specialized input:

| Format | Renders as |
|--------|-----------|
| `"password"` | Masked input — ephemeral token replaces the value in the resolver payload |
| `"date"` | Date picker |
| `"date-time"` | Date + time picker |
| `"email"` | Email input — pre-submission guard enforces valid address format |
| `"uri"` | URL input — pre-submission guard enforces `https?://...` format |
| `"textarea"` | Multi-line textarea |

```json
{
  "properties": {
    "due_date":      { "type": "string", "format": "date" },
    "contact_email": { "type": "string", "format": "email" },
    "report_url":    { "type": "string", "format": "uri" },
    "notes":         { "type": "string", "format": "textarea" }
  }
}
```

---

## Required Fields

Every required input — text, select, number, upload, or checklist group — shows a red asterisk at its label and blocks submission when empty. A checklist with `x-lt-require-all` is required by definition and carries the asterisk too. Required or optional is never a guess.

```json
{
  "required": ["decision"],
  "properties": {
    "decision": { "type": "string", "enum": ["approve", "reject"] },
    "notes":    { "type": "string", "description": "Optional comments" }
  }
}
```

A required `object` field (e.g. a `checklist` widget) is satisfied when at least one of its boolean values is `true`.

Hidden fields — those suppressed by `x-lt-showIf` at submit time — are skipped from required validation. See [x-lt-show-if.md](x-lt-show-if.md) for conditional required fields.

---

## Read-Only Fields

Fields with `readOnly: true` display as static text — the value is shown but cannot be edited:

```json
{
  "properties": {
    "request_amount": { "type": "number", "readOnly": true },
    "approved_amount": { "type": "number", "description": "Enter the approved amount" }
  }
}
```

Use `readOnly` with `x-lt-hide-if-empty: true` to suppress empty fact fields entirely (see [x-lt-show-if.md](x-lt-show-if.md)).

Use `readOnly` with `x-lt-widget: "markdown"` to embed a rendered content block — SOPs, checklists, review instructions — inside the form (see [x-lt-widget.md](x-lt-widget.md)).

---

## Schema Title and Description

`title` and `description` at the schema root appear in the form header:

- **`title`** — shown as the form section header
- **`description`** — short subtitle beneath the title; keep to a phrase; longer guidance belongs in [`x-lt-help`](x-lt-layout.md#help-panel-x-lt-help)

Individual field `title` and `description` render as the field label and inline help text, respectively.

```json
{
  "title": "Expense Approval",
  "description": "Review the expense report and approve or reject with notes.",
  "properties": {
    "approved": {
      "type": "boolean",
      "title": "Approve",
      "description": "Check to approve. Leave unchecked to reject."
    }
  }
}
```

---

## Credential Fields

Password fields (`"format": "password"`) are masked in the UI. On submit, the platform replaces the plain-text value with a short-lived ephemeral token (`eph:v1:*`, 15-minute TTL) before storing or signaling it to the workflow — the secret is never written to the escalation record.

```json
{
  "properties": {
    "api_key":    { "type": "string", "description": "API Key" },
    "api_secret": {
      "type": "string",
      "format": "password",
      "description": "API Secret — stored as an ephemeral token, never in plain text"
    }
  },
  "required": ["api_key", "api_secret"]
}
```

The workflow receives the `eph:v1:*` token and passes it to the integration layer for redemption.

---

## Draft Persistence

Form edits are saved locally (browser storage, per escalation) a moment after each change and restored when the resolver returns to the item — a lapsed claim, an accidental navigation, or a browser restart keeps typed input intact. The draft holds field values only; the form definition always renders from the current schema resolution, so a draft never resurrects a stale form. Pristine, untouched defaults are not stored. The draft clears when the escalation is resolved, acknowledged, or cancelled from that browser.

---

## Accessibility

Generated form controls carry the wiring assistive technology depends on:

- Every input is associated with its label (`label[for]` → `input[id]`), and checkbox labels wrap their controls.
- Required fields set `aria-required`; failing fields set `aria-invalid` and link their message via `aria-describedby`.
- Inline validation messages and the side panel's error list render as `role="alert"` live regions, so corrections are announced as they happen.
- The checklist widget is a `role="group"` labeled by its field description.
- A locked form (unclaimed, claimed by another user, or a lapsed claim) is `inert`: its fields leave the tab order entirely rather than merely looking disabled.
- Modals are `role="dialog"` with `aria-modal` and a labelled title; Escape closes them.
- The error panel's entries are buttons — clicking one scrolls to and focuses the failing field, keyboard included.

---

## Designing the Form

To create a polished resolve experience:

1. Set `title` on the schema — it becomes the form section header
2. Set `x-lt-help` — SOPs, tables, and links render in the side panel as markdown with `{{domain.path}}` tokens for live record values (see [x-lt-layout.md](x-lt-layout.md#help-panel-x-lt-help))
3. Use `readOnly` fields for context the human needs to see but not change
4. Use `x-lt-order` to put the most important fields first (see [x-lt-layout.md](x-lt-layout.md))
5. Use `required` to guide users on what must be filled
6. Use field-level `description` for inline help text
