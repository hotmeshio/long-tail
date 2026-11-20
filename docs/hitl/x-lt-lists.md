# Lists (`type: "array"`)

A list field is edited like any other field: a few keystrokes to add a value, a cell to fix a quantity, a mark on what a reviewer changed. The control follows the shape of `items`.

| Shape | `items` | Control |
|-------|---------|---------|
| Closed set of scalars | `x-lt-options` on the field | Chips, or a picker past 15 options |
| Open list of scalars | `type: "string"`, `"number"`, `"integer"` | Pills with free entry |
| Rows of one object shape | `type: "object"` with `properties` | Editable table |
| Evidence: text plus attributes that vary | `type: "object"`, properties optional | Read-only entries (see [Evidence](#evidence-and-read-only-lists)) |

`type` may be nullable (`["array", "null"]`); a nullable list is a list in every control. A schema that already declares `items` needs no change: the control is chosen by shape. `x-lt-widget` overrides the choice: `"pills"`, `"rows"`, or `"json"` for the raw editor (see [x-lt-widget.md](x-lt-widget.md#json)). A list with no `items` and no options is shown as read-only tags. A list that takes scans (`x-lt-scan`) stays a checklist.

---

## Pills

```json
"diagnosis_codes": {
  "type": ["array", "null"],
  "title": "Diagnosis codes",
  "items": { "type": "string", "pattern": "^[A-TV-Z][0-9][0-9AB](\\.[0-9A-TV-Z]{1,4})?$", "x-lt-transform": "uppercase" },
  "uniqueItems": true,
  "maxItems": 12,
  "x-lt-suggest": "lookup.icd10",
  "x-lt-sortable": true
}
```

Each value is a pill with a named remove control; the input sits at the end of the pills, in the same box.

- **Add.** Enter, Tab or a comma commits the typed text; leaving the field commits it too, so a typed value is never lost at submit. Pasting `E11.65, E11.42; I73.9` or one value per line adds one pill each.
- **Walk and edit.** Backspace in an empty input selects the last pill and a second Backspace removes it. Left and Right move between pills, Enter edits a pill in place, Delete removes it.
- **Check.** Each pill is validated against `items` (`type`, `enum`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `format`). A failing pill stays in the error tone and its title says why. `uniqueItems` refuses a duplicate with a short message and leaves the list unchanged; `maxItems` refuses the item past the limit.
- **Normalize.** `items.x-lt-transform` (`uppercase`, `lowercase`) runs on commit after the trim every pill gets. `items.type: "number"` or `"integer"` submits numbers.
- **Suggest.** `x-lt-suggest` names a context or lookup path (the sources `x-lt-options` reads) and offers type-ahead with labels. A suggestion is a convenience: on an open list a value that is not suggested is still accepted.
- **Order.** The list keeps the order entered. `x-lt-sortable: true` adds Alt+Left and Alt+Right to move a pill.

## Closed sets

A list with `x-lt-options` takes only its options. Up to 14 options show as chips; with 15 or more, or `x-lt-display: "picker"`, the picked values show as pills and a type-ahead adds from the options (typing a label or a value). Option labels show on the pill, in the review line and in the read-only display.

A proposed value outside the option list is kept, never dropped: it shows as a warning pill (**not a known option**) until the reviewer removes it, and validation decides whether it may be submitted.

---

## Rows

```json
"order_lines": {
  "type": ["array", "null"],
  "title": "Order lines",
  "minItems": 1,
  "maxItems": 20,
  "x-lt-add-label": "Add a line",
  "x-lt-sortable": true,
  "x-lt-item-key": "hcpcs",
  "items": {
    "type": "object",
    "required": ["hcpcs", "quantity"],
    "x-lt-order": ["hcpcs", "quantity", "side", "description"],
    "properties": {
      "hcpcs":       { "type": "string",  "title": "HCPCS", "pattern": "^[A-V][0-9]{4}$", "x-lt-options": "lookup.hcpcs", "x-lt-width": "sm" },
      "quantity":    { "type": "integer", "title": "Qty", "minimum": 1, "maximum": 12, "x-lt-width": "xs" },
      "side":        { "type": "string",  "title": "Side", "enum": ["left", "right", "bilateral"] },
      "description": { "type": "string",  "title": "Description", "x-lt-width": "fill" }
    }
  }
}
```

One row per item, one column per property in `items.x-lt-order` (then declaration order), headed by each property's `title`. Every cell is the control its property declares: text, number, date, a select from `enum` or `x-lt-options`, a Yes/No select, chips, or pills for a nested list.

- **Row scope.** A cell's `x-lt-options` and `x-lt-showIf` read their own row through the `row` domain (`row.hcpcs`), beside `resolver`, `envelope` and the rest.
- **Rows.** The add button sits under the table (Enter in the last cell of the last row also adds one); each row can be duplicated and removed; `x-lt-sortable` adds reordering. At `minItems` or `maxItems` the control is disabled and says why. A new row starts from each property's `default`. A row left entirely empty is dropped when the form is submitted.
- **Cells.** Tab moves cell to cell and row to row; Escape puts back the cell you are in. Pasting tab-separated rows from a spreadsheet fills cells from the focused cell onward. A property with `readOnly: true` is a locked column.
- **Width.** `x-lt-width` of `xs`, `sm`, `md` or `fill` sizes a column. Geometry follows the container: below the `@table` width each row folds into labeled cells, and the table never scrolls sideways.
- **Undeclared properties** travel with their row, untouched, unless `items.additionalProperties` is `false`.

Keyboard: Alt+Enter duplicates a row, Alt+Delete removes it, Alt+Up and Alt+Down move it when sortable. The form's Instructions panel lists the shortcuts for the controls the form uses.

---

## Evidence and read-only lists

A list that is `readOnly`, a locked form, a resolved row and the escalation detail all show the same display. Scalars read as pills (with option labels), declared rows as a table, and evidence as entries:

```json
"callus_evidence": {
  "type": ["array", "null"],
  "readOnly": true,
  "x-lt-item-layout": "evidence",
  "x-lt-item-title": "quote",
  "x-lt-collapse-after": 3
}
```

`x-lt-item-title` names the property shown as the body line; the remaining attributes read as small labeled values beneath it (`Status current`, `Source section DERMATOLOGICAL`), booleans as Yes or No, keys as words. Attributes come from the item itself when `items.properties` is not declared, so each fact can carry its own set. Past `x-lt-collapse-after` items (default 3) the list shows **Show N more**.

## Not stated and empty

For a nullable list, `null` means "not stated" and `[]` means "none". A proposed `null` shows **Not stated**, and submitting it untouched submits `null`. A list the reviewer empties submits `[]`. **Clear to "not stated"** returns a filled list to `null`. `null` against `[]` counts as a change in the review. `required` on a list means at least one item.

---

## Validation

One pass runs in the form and on the wire. Per item: `type`, `enum` and `x-lt-options` membership, `pattern`, length and numeric bounds, `format` (`email`, `uri`, `date`, `date-time`), and for rows `required`, each property, and `additionalProperties: false`. Across the list: `minItems`, `maxItems`, `uniqueItems`.

Messages name the item: `Item 2: Invalid format`, `Row 2, Qty: Minimum value is 1`. A 422 carries the same message plus a JSON `pointer` into the submitted payload through the field's `x-lt-bind` path:

```json
{ "field": "order_lines", "message": "Row 2, Qty: Minimum value is 1", "pointer": "/facts/rx/order_lines/1/quantity" }
```

A role's `form_schema` is checked for its list tokens when it is saved, seeded, or sent to the `validate_schema` MCP tool as `form_schema`: a `rows` widget over non-object items, an `x-lt-item-key` that is not an item property, a malformed `x-lt-locate`, and the like are refused with a message naming the field.

## Review

A list takes part in [x-lt-confidence](x-lt-confidence.md) like any field.

- **List score.** A number at the list's bound path in `envelope.confidence` marks the control with its tranche and counts in the review key.
- **Item scores.** An array at the path, aligned with the value, scores each pill or row; the field's tranche is the worst of its items. For rows, an object per item scores cells: `[{ "hcpcs": 0.99, "quantity": 0.55 }]` marks the Qty cell Low. `x-lt-confidence: false` on an item property leaves that column unscored. An item the reviewer adds carries no mark.
- **What changed.** While editing and after submit, added items are marked **Added**, a removed item stays visible struck through (with **Restore** while editing), and a changed cell shows **Edited** with its proposed value.
- **Comparison.** Lists compare by position. `x-lt-item-key` (rows) compares by key and `x-lt-unordered: true` ignores order, so a reorder alone is not a change. Scalar items compare as every answer does (trimmed, `"42"` equals `42`).
- **Facets.** `review_changed` counts a changed list as one changed field. `review_items_changed` counts the items added, removed and edited across the form's lists.

## Documents

An item can point at the document beside the form:

```json
"x-lt-locate": { "file": "file.review", "page": "page", "quote": "quote" }
```

`page` and `quote` name the item properties holding the page number and the text; `file` names the document by its `x-lt-source` or field key (the first document when omitted). Focusing a row, or an evidence entry, scrolls the document to that page and highlights the quote when the file has a text layer; with no page, the text layer is searched for the quote. With neither a page nor a text layer, nothing happens.
