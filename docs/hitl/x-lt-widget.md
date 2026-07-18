# Custom Widgets (`x-lt-widget`)

For rich inputs beyond standard HTML types, set `x-lt-widget` on any field:

| Widget | Description |
|--------|------------|
| `"file-upload"` | File picker with drag-and-drop. Stores a base64 data URL. Use `accept` to filter file types. |
| `"code-editor"` | Monospace textarea with tab-key support. Use `x-lt-language` for the syntax hint. |
| `"signature"` | HTML5 Canvas drawing pad. Outputs a PNG data URL. |
| `"rich-text"` | Tall textarea for formatted text input. |
| `"markdown"` | Markdown source rendered with headings, tables, lists, code blocks. Editable by default; set `readOnly: true` for a pure content block. |
| `"checklist"` | Dynamic labeled checkboxes driven by runtime data. Items come from a `"domain.path"` declared in `x-lt-source`. |

---

## File Upload

```json
{
  "properties": {
    "screenshot": {
      "type": "string",
      "x-lt-widget": "file-upload",
      "accept": "image/*",
      "description": "Upload a screenshot of the issue"
    },
    "signed_form": {
      "type": "string",
      "x-lt-widget": "file-upload",
      "accept": ".pdf",
      "description": "Signed authorization form (PDF)"
    }
  }
}
```

The submitted value is a base64 data URL (`data:image/png;base64,...`). `accept` follows the HTML `<input accept>` syntax.

---

## Code Editor

```json
{
  "properties": {
    "fix_script": {
      "type": "string",
      "x-lt-widget": "code-editor",
      "x-lt-language": "sql",
      "description": "SQL migration to apply"
    }
  }
}
```

`x-lt-language` is a display hint only — the editor does not enforce syntax.

---

## Signature

```json
{
  "properties": {
    "signature": {
      "type": "string",
      "x-lt-widget": "signature",
      "description": "Sign to confirm"
    }
  }
}
```

The submitted value is a PNG data URL of the canvas drawing.

---

## Markdown

Without `readOnly`, the field is a markdown editor — the resolver writes source in a Write/Preview toggle and the submitted value is the markdown text.

With `readOnly: true`, the field is a rendered content block. The markdown in its `default` displays as HTML inside the form — headings, tables, checklists, callouts. The versioned schema carries the page source itself, so review instructions and SOPs version with the form they belong to.

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

---

## Checklist (`x-lt-source`)

A dynamic list of labeled checkboxes driven by runtime data in the escalation context. The item definitions come from a domain path declared in `x-lt-source` — the form schema itself never changes as item count or labels vary across escalations.

The field type must be `"object"`. The submitted value is `Record<string, boolean>` keyed by item id (e.g. `{ "step_0": true, "step_1": false }`).

```json
{
  "properties": {
    "checks": {
      "type": "object",
      "description": "Work through each step and check it off.",
      "x-lt-widget": "checklist",
      "x-lt-source": "envelope.checklist_items"
    }
  },
  "required": ["checks"]
}
```

`x-lt-source` uses the `"domain.path"` convention (same as `x-lt-showIf` and `x-lt-help` tokens). The renderer expects an array of `{ id: string; label: string; required?: boolean }` objects at that path.

- `"envelope"` — for item definitions that are render data only (no query cost). The workflow puts them in `conditionLT`'s `envelope` parameter.
- `"metadata"` — only when items need to be GIN-indexed and searchable as facets. Adds index cost.

Marking an item `required: true` flags it with an asterisk in the UI. A `required` checklist field is blocked from submission until at least one item is checked. When no items are checked after a submission attempt, every unchecked item that is individually required (or all unchecked items when the field itself is required) highlights in red. Once any item is checked — satisfying the group requirement — all per-item highlights clear.

**Workflow side:**

```typescript
const checklistItems = [
  { id: 'doc',     label: 'All supporting documentation is attached', required: true },
  { id: 'contact', label: 'Contact details have been verified',        required: true },
  { id: 'photos',  label: 'Before/after photos are present',           required: false },
];

const decision = await conditionLT<{ checks: Record<string, boolean> }>(signalId, {
  role: 'checklist-operator',
  envelope: {
    checklist_items: checklistItems,
    formDefaults: {
      // Pre-populate all checkboxes as unchecked
      checks: Object.fromEntries(checklistItems.map((i) => [i.id, false])),
    },
  },
});

const allConfirmed = Object.values(decision.checks).every(Boolean);
```

Pre-populating `formDefaults.checks` opens the form with every checkbox unchecked rather than indeterminate.

The `examples/workflows/checklist-confirmation/` and `examples/workflows/constraint-form/` workflows are complete references.
