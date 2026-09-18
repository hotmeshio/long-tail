# x-lt-invoke — start a workflow from the form

A role's `form_schema` can place a control that starts another workflow: a link, an icon-link, or a button that either fires the workflow at once with a payload mapped from the escalation, or opens the workflow's own invoke form in a dialog, prefilled from the same mapping. The control reuses the Invoke Tool page end to end: the same per-caller list decides who sees it, the same `input_schema` gate validates the payload, the same registered icon leads the label, and the run's outcome arrives over the same live events.

The field is display-only. It carries no answer, is dropped from the resolver payload, and must never appear in `required`.

```jsonc
"print_pamphlet": {
  "type": "string",
  "readOnly": true,
  "x-lt-widget": "invoke",
  "x-lt-invoke": {
    "workflow": "printPamphlet",
    "data": { "order": { "id": "{{metadata.orderId}}" }, "copies": 1 },
    "metadata": { "escalationId": "{{escalation.id}}" },
    "modal": true
  },
  "title": "Print pamphlet",
  "description": "Prints the patient pamphlet for this order",
  "x-lt-section": "Tools",
  "x-lt-span": 2,
  "x-lt-showIf": "metadata.orderId"
}
```

## The declaration

| Key | Type | Meaning |
|-----|------|---------|
| `workflow` | string | The `workflow_type` to start. Required. |
| `data` | object | The nested `data` the invoke API receives. Leaves interpolate `{{domain.path}}` tokens against the escalation context. Defaults to `{}`. |
| `metadata` | object | Extra run metadata, merged over the workflow's declared `envelopeSchema.metadata`. Same interpolation. |
| `modal` | boolean | `true` opens the workflow's invoke form prefilled; `false` (default) posts `data` at once. |
| `confirm` | string | Direct mode only: a prompt shown before the post. Tokens interpolate. |
| `variant` | `"link"` \| `"button"` | The control's shape. Defaults to `link`. |
| `icon` | boolean | Lead the label with the workflow's registered icon, the one the registry picker sets and the Invoke Tool page shows. Defaults to `true`. |

The field's `title` is the label; without one the workflow type reads as a title (`printPamphlet` → **Print Pamphlet**). `description` renders as the helper line beneath it. Every layout token composes: `x-lt-section`, `x-lt-span`, `x-lt-showIf`, `x-lt-order`.

## Mapping values

`data` is written once, in the shape the workflow receives. In direct mode it is posted as resolved. In modal mode the same object prefills the workflow's `input_schema` by inverting each field's `x-lt-bind`, so a field bound to `printer.serialNumber` opens holding `data.printer.serialNumber`. A workflow without an `input_schema` gets its envelope template form with `data` merged over the template.

Interpolation keeps types:

| Leaf | Resolves to |
|------|-------------|
| `"{{metadata.copies}}"` | The raw context value: a number stays a number, a boolean a boolean, an array an array |
| `"ORD-{{metadata.orderId}}"` | A string |
| A token whose value is missing or null | The key is omitted, so the workflow's own defaults apply |
| A mixed string with any missing segment | The key is omitted |
| `1`, `true`, `"plain text"` | Passed through unchanged |

Objects and arrays recurse. The domains are the escalation form's: `escalation`, `metadata`, `envelope`, `payload`, `lookup`, and the live `resolver` values, so a mapping can carry what the operator has typed so far.

## Who sees it

The control renders only for workflows the signed-in user may invoke, read from the same per-caller list that drives the Invoke Tool page and its nav entry. A workflow outside that list leaves no trace in the form. The server runs the same predicate on the post. The control follows the form's claim state: it is live once the operator has claimed the escalation, and it leaves the form once the escalation is resolved, cancelled, or expired.

One request serves every invoke field on the page, and the list is shared with the rest of the dashboard's cache.

## Direct mode

Clicking the control posts `data` with the workflow's declared metadata (plus the field's `metadata` mapping) and the `certified` flag the workflow is registered with. The control gives way to **Working…** while the run is in flight, then reads **Completed** with the returned `data` as an outline beneath, or **Failed** with the reason. The outcome arrives over the same `system.workflow.{id}.completed` and `.failed` events the Invoke Tool page follows. Once the run has settled the control returns beneath the result, ready for another run. A warning offers to reconnect live events when they are off.

When the target declares an `input_schema`, the payload is checked against it before the post with the shared validation pass. Violations, from that check or from a server 422, list beneath the control with an **Open form** action that opens the workflow's form prefilled, so the operator completes what the mapping could not supply. A mapping meant for direct mode should satisfy the schema on its own; declare `confirm` when the action deserves a second look.

## Modal mode

`"modal": true` opens the workflow's invoke form in a dialog headed by its icon and title: the full x-lt-* form when the workflow declares an `input_schema`, with pinned lookups resolved, conditional sections, and the shared validation pass; the envelope template form otherwise. Prefilled values sit in their fields ready to be changed. Issues and the form's `x-lt-help` render inside the dialog.

Submit posts exactly as the Invoke Tool page does, and the dialog becomes a receipt with one action. While the run works it shows the workflow's icon and **Working…** with a Close control; closing leaves the run going. On completion it reads **Completed** with the returned `data` as an outline and a **Done** button. On failure it reads **Failed** with the reason, **Try again** returns to the form holding what was typed, and Close dismisses. The backdrop does not dismiss the dialog; Escape and the close control do. Each opening starts clean.

## Example

The `printer-fleet` role's work form offers the fleet tools for the machine on screen. Its escalations carry `metadata.serialNumber`, the same facet the fleet-tools serial lookup reads, so the dialog opens with the serial already chosen:

```typescript
fleet_tools: {
  type: 'string',
  readOnly: true,
  'x-lt-widget': 'invoke',
  'x-lt-invoke': {
    workflow: 'fleetTools',
    modal: true,
    data: { printer: { serialNumber: '{{metadata.serialNumber}}' } },
  },
  'x-lt-section': 'Tools',
  'x-lt-span': 2,
  title: 'Fleet tools',
  description: 'Reprint a label, change filament, or report this machine offline',
}
```

See [`examples/seed-fleet-sim.ts`](../../examples/seed-fleet-sim.ts) for the role and [invoke-form.md](invoke-form.md) for the `fleetTools` form it opens.
