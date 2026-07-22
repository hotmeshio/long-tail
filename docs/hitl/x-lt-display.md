# Dictionary Display (`x-lt-display`)

Read-only facts — order numbers, quantities, product names — render as a dense definition list when dictionary display is requested: labels beside values in a compact grid, a run of consecutive facts merged into one list. This is the display for reference data the resolver reads but never edits.

`x-lt-display: "dictionary"` applies at three levels; the nearest wins:

| Level | Placement | Applies to |
|-------|-----------|-----------|
| Field | on the property | that field |
| Section | `x-lt-section-options` at the schema root | read-only fields in that section |
| Schema | at the schema root | every read-only field |

Only read-only fields (`readOnly: true`) render as dictionary rows. Editable fields keep their inputs, and content widgets (`markdown`, `attachment`, `image`) keep their block rendering regardless of display settings.

```json
{
  "x-lt-layout": "two-column",
  "x-lt-display": "dictionary",
  "properties": {
    "po":             { "type": "string", "title": "PO",       "readOnly": true, "x-lt-section": "The Order" },
    "order_id":       { "type": "string", "title": "Order ID", "readOnly": true, "x-lt-section": "The Order" },
    "left_quantity":  { "type": "number", "title": "Left Qty", "readOnly": true, "x-lt-section": "The Order" },
    "right_quantity": { "type": "number", "title": "Right Qty","readOnly": true, "x-lt-section": "The Order" },
    "approved":       { "type": "boolean", "x-lt-section": "The Decision" }
  }
}
```

The four order facts render as one two-column dictionary under "The Order"; `approved` stays a checkbox.

## Section Options (`x-lt-section-options`)

Per-section display settings live at the schema root, keyed by section name:

```json
{
  "x-lt-section-options": {
    "The Order": { "display": "dictionary", "columns": 2 }
  }
}
```

| Option | Values | Meaning |
|--------|--------|---------|
| `display` | `"dictionary"` | Read-only fields in the section render as dictionary rows |
| `columns` | `1` \| `2` | Dictionary column count; defaults to 2 in two-column layouts, 1 otherwise |

Two-column dictionaries fill **row by row**: consecutive items share a row, so ordering controls pairing — declare `left_quantity` and `right_quantity` together and they render side by side, Left first.

## Value formatting

Strings and numbers render as-is. Booleans render as Yes / No. Objects and arrays render as compact JSON. Empty values (`null`, `""`) render as an em dash.

Labels resolve the same way as form labels: the `title` keyword when present, otherwise the field key with snake/kebab separators title-cased. Declare `title` on every fact — `"PO"`, `"Order ID"` — for labels that read like product copy rather than column names.

Presentation tokens (`x-lt-display`, `x-lt-section-options`, `x-lt-column-group`) never affect validation or the submitted payload; a schema renders identically strict with or without them.
