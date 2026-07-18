# Form Fields

The dashboard renders forms automatically from JSON Schema. No frontend code needed.

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

Fields listed in `required` show a red asterisk and block submission when empty:

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

## Designing the Form

To create a polished resolve experience:

1. Set `title` on the schema — it becomes the form section header
2. Set `x-lt-help` — SOPs, tables, and links render in the side panel as markdown with `{{domain.path}}` tokens for live record values (see [x-lt-layout.md](x-lt-layout.md#help-panel-x-lt-help))
3. Use `readOnly` fields for context the human needs to see but not change
4. Use `x-lt-order` to put the most important fields first (see [x-lt-layout.md](x-lt-layout.md))
5. Use `required` to guide users on what must be filled
6. Use field-level `description` for inline help text
