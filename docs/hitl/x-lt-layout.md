# Layout, Ordering, Sections, Binding, and Help

---

## Two-Column Layout (`x-lt-layout`)

Set `"x-lt-layout": "two-column"` at the schema root to arrange fields in a 2-column grid. Use `"x-lt-span": 2` on a field to span the full width.

```json
{
  "x-lt-layout": "two-column",
  "properties": {
    "first_name": { "type": "string" },
    "last_name":  { "type": "string" },
    "notes":      { "type": "string", "format": "textarea", "x-lt-span": 2 }
  }
}
```

---

## Field Ordering (`x-lt-order`)

By default, fields render in JSON key order. `x-lt-order` sets an explicit sequence. Fields not listed in `x-lt-order` render after the listed ones in their original key order.

```json
{
  "x-lt-order": ["priority", "decision", "notes"],
  "properties": {
    "notes":    { "type": "string" },
    "decision": { "type": "string", "enum": ["approve", "reject", "defer"] },
    "priority": { "type": "number" }
  }
}
```

---

## Section Groups (`x-lt-section`)

Group related fields under a labeled section by adding `"x-lt-section": "Label"` to each property. Fields that share the same consecutive section name are collected into one group with a header.

Sections are ordered by the first field that carries the section name (respects `x-lt-order`). A field without `x-lt-section` belongs to an unnamed group rendered without a header. Named sections render with a left accent line, a small icon, and the label in uppercase.

```json
{
  "x-lt-layout": "two-column",
  "x-lt-order": ["patient_id", "heel_cup", "pdac", "approved", "notes"],
  "properties": {
    "patient_id": { "type": "string", "readOnly": true, "x-lt-section": "Facts", "x-lt-hide-if-empty": true },
    "heel_cup":   { "type": "string", "readOnly": true, "x-lt-section": "Facts", "x-lt-hide-if-empty": true },
    "pdac":       { "type": "boolean","readOnly": true, "x-lt-section": "Facts", "x-lt-hide-if-empty": true },
    "approved":   { "type": "string", "enum": ["yes", "no"],       "x-lt-section": "Action" },
    "notes":      { "type": "string", "format": "textarea", "x-lt-span": 2, "x-lt-section": "Action" }
  }
}
```

---

## Payload Binding (`x-lt-bind`)

The form is flat; the payload the workflow consumes rarely is. A field may declare `x-lt-bind` — the path its value occupies in the resolver payload (dot keys, optional `[n]` indices). The dashboard maps the flat form through the binds on submit, and reverse-maps `envelope.formDefaults` through them to prefill. A field with no bind lands at its own name at the payload root.

```json
{
  "properties": {
    "customer_name":  { "type": "string",  "x-lt-bind": "customer.name" },
    "contact_email":  { "type": "string",  "format": "email", "x-lt-bind": "customer.email" },
    "tier":           { "type": "string",  "enum": ["starter", "professional"], "x-lt-bind": "contract.tier" },
    "notes":          { "type": "string",  "format": "textarea" }
  }
}
```

Submitting `{ customer_name, contact_email, tier, notes }` produces:

```json
{
  "customer": { "name": "…", "email": "…" },
  "contract": { "tier": "…" },
  "notes": "…"
}
```

Only the form is versioned on the role — the payload shape is the workflow's own contract, produced by the binds. Evolve the form and its binds together, and the workflow's resolver type in the same commit.

---

## Help Panel (`x-lt-help`)

Schema-level `x-lt-help` carries the form's guidance — checklists, tier tables, callouts, links — as markdown. The dashboard renders it in the side panel beside the form, so the form itself stays a clean title-and-fields surface while the SOP sits one glance to the right. The help text versions with the form: it lives in the same `form_schema` snapshot in `lt_role_schemas`.

```json
{
  "title": "Customer Intake",
  "x-lt-help": "### Review checklist\n\n1. Confirm the **legal name** matches.\n2. Send a test message before approving.\n\nThis escalation is **{{escalation.status}}** in the **{{escalation.role}}** queue.",
  "properties": { }
}
```

### `{{domain.path}}` tokens

`{{domain.path}}` tokens in `x-lt-help` interpolate live values from the escalation record. Five domains are available:

| Domain | Resolves against |
|--------|-----------------|
| `escalation` | The escalation row (`{{escalation.role}}`, `{{escalation.status}}`) |
| `metadata` | The row's metadata dict (`{{metadata.schema_version}}`) |
| `envelope` | The workflow-sent input envelope (`{{envelope.min_score}}`) |
| `payload` | The escalation context payload (`{{payload.category}}`) |
| `resolver` | The submitted resolver payload (`{{resolver.notes}}`) |

A missing value renders as an em dash. Links whose `href` starts with `/` navigate inside the dashboard.

### Help fallback chain

The side panel's Help view resolves in order: `x-lt-help` → `x-lt-context` (plain text) → a state-aware hint ("Claim this escalation to enable the form", "Fill out the form and submit to resolve it", and so on). The panel always gives the resolver a prompt.

The panel's other views surface the record itself:

| View | Shows | Available to |
|------|-------|--------------|
| **Help** | `x-lt-help` markdown, or a state-aware hint | Everyone |
| **Details** | Status, role, priority, claim provenance, timestamps | Everyone |
| **AI Analysis** | Triage diagnosis and corrections | When AI is enabled and triage data is present |
| **Metadata** | The row's metadata values | Everyone |
| **Context** | Input envelope, escalation context, resolver payload | Everyone |
| **Errors** | Pre-submission validation failures with click-to-focus | When submit is blocked |
| **Record** | The raw escalation JSON | Builders (admins, superadmins, engineers) |

---

## Complete Layout Example

Two-column intake form with sections, help panel, ordering, and bindings:

```json
{
  "title": "Customer Intake",
  "description": "Complete all required fields then submit.",
  "x-lt-layout": "two-column",
  "x-lt-order": ["first_name", "last_name", "email", "phone", "tier", "notes"],
  "x-lt-help": "### Intake checklist\n\n1. Confirm the **legal name** matches the ID on file.\n2. Verify the email is reachable — send a test message.\n3. Select tier based on the sales order.\n\n> Escalate non-standard contract language to legal.",
  "required": ["first_name", "last_name", "email", "tier"],
  "properties": {
    "first_name": { "type": "string",                             "x-lt-section": "Contact" },
    "last_name":  { "type": "string",                             "x-lt-section": "Contact" },
    "email":      { "type": "string", "format": "email",          "x-lt-section": "Contact", "x-lt-bind": "customer.email" },
    "phone":      { "type": "string",                             "x-lt-section": "Contact" },
    "tier": {
      "type": "string",
      "enum": ["free", "pro", "enterprise"],
      "description": "Select the customer tier",
      "x-lt-section": "Contract",
      "x-lt-bind": "contract.tier"
    },
    "notes": {
      "type": "string",
      "format": "textarea",
      "x-lt-span": 2,
      "description": "Additional notes",
      "x-lt-section": "Contract"
    }
  }
}
```
