# Scan fields: `x-lt-scan`

A form field that takes a scan. While a claimed form is open and editable, a scan whose scheme a field accepts fills that field instead of running as a global scan. A scan that no field accepts, and every badge scan, goes to the global scan pipeline as usual.

```json
{
  "type": "object",
  "x-lt-scan-submit": true,
  "required": ["containerCode"],
  "properties": {
    "containerCode": {
      "type": "string",
      "title": "Container",
      "x-lt-scan": {
        "schemes": [14],
        "expect": ["metadata.containerCode", "envelope.offeredContainers"],
        "expect-error": "This item goes in {{expected}}."
      }
    },
    "parts": {
      "type": "array",
      "items": { "type": "string" },
      "x-lt-scan": { "schemes": [16], "expect": ["envelope.expected_upcs"], "multiplicity": "count" }
    }
  }
}
```

## Field tokens

| Key | Meaning |
|---|---|
| `schemes` | The scan scheme versions the field accepts. Required. |
| `value` | `"target"` (default) writes the scanned target; `"code"` writes the code as scanned. |
| `expect` | Context paths (`metadata.*`, `envelope.*`, `lookup.*`, …) whose values the field accepts. A path that holds a list contributes every entry. |
| `expect-error` | The message for a scan outside `expect`; `{{expected}}` lists what the field accepts. Default: `Expected {{expected}}`. |
| `multiplicity` | Array fields: `"count"` admits a value as many times as `expect` lists it (a part expected twice takes two scans); otherwise each expected value is admitted once. |
| `prompt` | Array fields: the instruction shown while the field is empty. Default: the field's `description`. |

A string field is replaced by a scan. An array field appends, up to `maxItems`. Manufacturer barcodes compare as GTINs, so a UPC-A matches its 14-digit form.

An array scan field reads as a checklist: its prompt while empty, `n of N` beside the label, and a remove control on each scanned value while the form is editable. `N` is what `expect` admits (each listing under `multiplicity: "count"`, each distinct value otherwise), or `maxItems`, so the count and the admission gate agree. A removed value is admitted again on the next scan.

## Which field takes the scan

The focused field, when it accepts the scan's scheme. Otherwise the first field in `x-lt-order` that accepts it and still has room. Otherwise the first field that accepts it.

## A batch roster takes scans

A [roster](x-lt-roster.md) whose expected set is the row's batch (`expected: { batch: true }`) may declare `x-lt-scan` with its `schemes`. On the open, claimed form, a scan of one of those schemes checks the entry off on the server, with nothing focused: the row's first open entry whose key is the scanned code is filled as the person acting, with `{ scannedCode }` as the entry's payload (`POST /api/escalations/:id/roster-scan`). An entry the list does not expect, or one already checked off, is refused under the roster and nothing is written. On a read-only station login the first scan asks for a badge, and the badge stays primed for the scans that follow, within its grant's uses and lifetime.

```json
"items": {
  "type": "string", "readOnly": true, "x-lt-widget": "roster",
  "x-lt-roster": { "expected": { "batch": true, "labels": "envelope.item_labels" } },
  "x-lt-scan": { "schemes": [16] }
}
```

## Expected values are checked on both sides

A scan outside `expect` shows as an error directly under the field that refused it, and leaves the field as it was; an accepted scan shows a confirmation in the same place. Either way the field scrolls into view. The same check runs in the shared validator at submit, so a typed value outside `expect` is a field error in the form and a 422 from the API.

## `x-lt-scan-submit`

Root-level `true`: once every required scan field holds a value and the form validates, the form submits on its own. On a shared station the submit raises the usual badge prompt, so the motion is: scan the container into the open form, scan your badge.
