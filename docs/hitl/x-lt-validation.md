# Pre-Submission Validation

The form runs a full validation pass before any submit is accepted. Every visible field is checked in sequence; the first failure displays an inline error and the submit is blocked. The right-side panel opens automatically with a tabular breakdown of all errors; clicking any error item scrolls to and focuses the corresponding field.

---

## Required

Fields listed in the schema's `required` array block submission when empty. A red asterisk marks required fields. Required validation is skipped for fields hidden by `x-lt-showIf` at submission time.

```json
{
  "required": ["approved", "reference_code"],
  "properties": {
    "approved":       { "type": "boolean" },
    "reference_code": { "type": "string" }
  }
}
```

---

## Format Guards

`"format": "email"` and `"format": "uri"` are enforced before submission:

| Format | Guard |
|--------|-------|
| `"email"` | Must match `user@host.tld` |
| `"uri"` | Must start with `https://` or `http://` |

Format errors appear inline beneath the field as soon as the field is blurred.

---

## String Length Bounds

| Keyword | Source | Type |
|---------|--------|------|
| `minLength` | JSON Schema standard | Static integer |
| `maxLength` | JSON Schema standard | Static integer |
| `x-lt-min-length` | Long-tail extension | `"domain.path"` resolved at submission time |
| `x-lt-max-length` | Long-tail extension | `"domain.path"` resolved at submission time |

Static and dynamic bounds compose: if both `minLength` and `x-lt-min-length` are present, the static value is used (the dynamic path is a fallback only when no static value is set).

```json
{
  "properties": {
    "reference_code": {
      "type": "string",
      "minLength": 3
    },
    "notes": {
      "type": "string",
      "format": "textarea",
      "x-lt-max-length": "envelope.max_notes_length"
    }
  }
}
```

When `envelope.max_notes_length` is `500`, the notes field blocks submission once the input exceeds 500 characters. The error reads `Maximum 500 characters (534 entered)`. Textarea fields with a `maxLength` or `x-lt-max-length` bound also show a live `X / N` character counter as you type — the counter turns red when the limit is exceeded, before the form is submitted.

---

## Numeric Bounds

| Keyword | Source | Type |
|---------|--------|------|
| `minimum` | JSON Schema standard | Static number |
| `maximum` | JSON Schema standard | Static number |
| `exclusiveMinimum` | JSON Schema standard | Static number |
| `exclusiveMaximum` | JSON Schema standard | Static number |
| `x-lt-minimum` | Long-tail extension | `"domain.path"` resolved at submission time |
| `x-lt-maximum` | Long-tail extension | `"domain.path"` resolved at submission time |

Static and dynamic bounds compose: if both `minimum` and `x-lt-minimum` are present, the static value is used.

```json
{
  "properties": {
    "score": {
      "type": "number",
      "maximum": 100,
      "x-lt-minimum": "envelope.min_score"
    }
  }
}
```

When `envelope.min_score` is `60`, submitting a score of `45` blocks with "Minimum value is 60".

---

## Dynamic Select Options (`x-lt-options`)

A select's option list can ride the escalation instead of the schema. The field-level token names a `"domain.path"`; the array of strings or numbers at that path becomes the field's options — one static role form, per-row legal values:

```json
{
  "properties": {
    "left_quantity": {
      "type": "number",
      "default": 0,
      "x-lt-options": "envelope.left_quantity_options"
    },
    "designation": {
      "type": "string",
      "x-lt-options": "envelope.return_stations"
    }
  }
}
```

When the envelope carries `left_quantity_options: [0, 1, 2, 3]`, the field renders as a dropdown offering exactly those values — an out-of-range answer is structurally impossible. The workflow mints only the small per-row array; the form itself stays on the role.

- A static `enum` takes precedence when both are present — the same static-over-dynamic rule as the bounds tokens.
- The declared `type` governs the value: a number-typed field emits the picked option as a number, a string-typed field as a string.
- While the current value is outside the option list (an empty init, options that shrank per-row), the select opens on an explicit disabled **Choose…** placeholder — never an implicit first option.
- A path that resolves to nothing (missing, empty array, no scalar entries) yields no options: the field renders as the plain input for its type and membership is not enforced for that submission.
- Membership is enforced on both sides of the wire: the dashboard constrains the choices, and an enforced role's server gate rejects a payload whose value is outside the row's resolved list with the canonical 422 (`Must be one of: 0, 1, 2, 3`).

---

## Checklist Completion (`x-lt-require-all`)

A checklist-widget field can require every item to be checked before submission:

```json
{
  "properties": {
    "checks": {
      "type": "object",
      "x-lt-widget": "checklist",
      "x-lt-source": "envelope.checklist_items",
      "x-lt-require-all": true
    }
  }
}
```

With `"x-lt-require-all": true`, the pre-submission pass fails unless every rendered item is checked — except items whose definition carries `required: false`, the explicit opt-out (e.g. an optional photos step). An item with `required: true` or no `required` key at all must be checked.

- A field hidden by `x-lt-showIf` at submit time is skipped entirely (the same rule as `required`).
- When `x-lt-source` resolves to a missing or empty array, the guard is vacuous — zero items never block.
- Composes with the `required` array: listing the field in `required` remains lawful and means at-least-one; `x-lt-require-all` is the stricter check and wins when both are present.

On a blocked submit, each unchecked mandatory item highlights red inline, and the error panel reads `N of M checks incomplete` with click-to-focus landing on the first unchecked item. Errors clear in real time as items are checked. The group carries `aria-invalid` and the message is announced as an alert, consistent with the rest of the validation wiring.

---

## Require Any of a Set (`x-lt-require-any`)

A schema root can require a value in **at least one** field of a group — the either/or form where a Left quantity or a Right quantity satisfies, but blank-both fails:

```json
{
  "x-lt-require-any": [["left_quantity", "right_quantity"]],
  "properties": {
    "left_quantity":  { "type": "number", "title": "Left Quantity" },
    "right_quantity": { "type": "number", "title": "Right Quantity" }
  }
}
```

The token is an array of groups; each group is an array of property names and enforces independently. A group passes when any member carries a value: `false` and `0` are answers; empty string, null, and undefined are not.

- Visibility composes: a member hidden by `x-lt-showIf` (or naming no schema property) can neither satisfy the group nor be demanded of the submitter, and a group whose members are all hidden is waived.
- An unsatisfied group yields one violation on the group's first visible field: `Enter a value for at least one of: Left Quantity, Right Quantity` (member titles, falling back to keys).
- Composes with `required`: a field listed in `required` must be filled regardless; the group check is the softer at-least-one layered on top.
- The same pass runs on both sides of the wire — the dashboard panel blocks the submit, and an enforced role's server gate rejects a violating payload with the canonical 422.

---

## Require a Combined Quantity (`x-lt-require-sum`)

For a group of **quantity** fields, `x-lt-require-any` is the wrong guard: `0` is an answer there, so counts defaulting to `0` vacuously satisfy the group. `x-lt-require-sum` reads the members as numbers and demands their sum reach a minimum — a Left quantity and a Right quantity can both default to `0`, and an all-zero submission still blocks:

```json
{
  "x-lt-require-sum": [{ "fields": ["left_quantity", "right_quantity"] }],
  "properties": {
    "left_quantity":  { "type": "number", "title": "Left Quantity", "default": 0 },
    "right_quantity": { "type": "number", "title": "Right Quantity", "default": 0 }
  }
}
```

The token is an array of groups; each group is `{ "fields": [...], "minimum": N }` and enforces independently. `minimum` defaults to `1` — the plain "at least one side must be positive" reading. Numbers contribute their value, numeric strings coerce, and everything else (empty, missing, non-numeric) contributes `0`.

- Visibility composes the same way as `x-lt-require-any`: a member hidden by `x-lt-showIf` (or naming no schema property) contributes nothing and is not demanded, and a group whose members are all hidden is waived.
- An unsatisfied group yields one violation on the group's first visible field: `Combined value of Left Quantity, Right Quantity must be at least 1` (member titles, falling back to keys).
- Composes with `required` and `x-lt-require-any` — each guard reports independently.
- The same pass runs on both sides of the wire — the dashboard panel blocks the submit, and an enforced role's server gate rejects a violating payload with the canonical 422.

---

## Pattern Guard

Apply a regular expression guard with `pattern`. If the input does not match, the field blocks submission. Provide `x-lt-pattern-error` for a human-readable error message; otherwise the generic "Invalid format" is shown.

```json
{
  "properties": {
    "reference_code": {
      "type": "string",
      "pattern": "^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$|^[A-Z0-9]$",
      "x-lt-pattern-error": "Use uppercase letters, digits, and dashes (e.g. QA-2024-001)"
    }
  }
}
```

---

## Dynamic Bounds — `"domain.path"` Resolution

`x-lt-minimum`, `x-lt-maximum`, `x-lt-min-length`, `x-lt-max-length`, and `x-lt-options` all accept a `"domain.path"` string. The value is resolved from the escalation context at the moment of submission — the same domain/path convention as `x-lt-showIf` and `x-lt-help` tokens.

| Domain | Resolves against |
|--------|-----------------|
| `envelope` | The workflow-sent input envelope |
| `metadata` | The row's metadata dict |
| `payload` | The escalation context payload |
| `escalation` | Top-level escalation row fields |

The path is dot-separated, with optional `[n]` array indices. A missing or non-numeric value at the path means the bound is not enforced for that submission.

**Workflow side — passing the bound in the envelope:**

```typescript
const decision = await conditionLT<{ score: number; notes: string }>(signalId, {
  role: 'quality-reviewer',
  envelope: {
    min_score: 60,
    max_notes_length: 500,
  },
  metadata: {
    form_schema: {
      properties: {
        score: { type: 'number', maximum: 100, 'x-lt-minimum': 'envelope.min_score' },
        notes: { type: 'string', 'x-lt-max-length': 'envelope.max_notes_length' },
      },
    },
  },
});
```

---

## Error Panel

When the pre-submission pass finds errors, the right-side panel opens automatically on the Errors view. The panel shows a numbered list of issues — field name and message — and each entry is a button: clicking it scrolls the form to the field and focuses it. The panel icon shows a `!` badge when errors are active.

The error panel updates in real-time as fields are corrected — fixing a field removes its entry from the panel immediately, without requiring another submit attempt. The panel clears entirely once all issues are resolved.

---

## Reference Example

`examples/workflows/constraint-form/` is the canonical reference for all constraint guards:

- `approved` — boolean toggle
- `rejection_reason` — hidden required field (`x-lt-showIf: '!resolver.approved'`)
- `reference_code` — `pattern` + `minLength` + `x-lt-pattern-error`
- `score` — `maximum: 100` + `x-lt-minimum: 'envelope.min_score'`
- `notes` — `x-lt-max-length: 'envelope.max_notes_length'`
- `checks` — checklist widget with `x-lt-source: 'envelope.checklist_items'`

The `quality-reviewer` role is seeded with two test escalations that carry different `min_score` and `max_notes_length` values so every dynamic bound is exercisable without code changes.

`examples/workflows/parameterized-form/` is the reference for per-row form parameterization:

- `left_quantity` / `right_quantity` — number selects with `x-lt-options` from `envelope.left_quantity_options` / `envelope.right_quantity_options`, both defaulting to `0`
- `designation` — string select with `x-lt-options` from `envelope.return_stations`
- `x-lt-require-sum` — the quantity pair must total at least 1

The `verdict-reviewer` role is seeded with two test escalations whose envelopes carry different quantity ranges and station lists, so the same role form offers different legal values per row.
