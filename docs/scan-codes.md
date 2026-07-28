# Scan Codes

A code printed on a physical object drives the platform from the factory
floor. Scanning it locates the object's digital twin — the escalation row
that represents it — checks the twin is in an expected queue and state, and
runs a configured action: open it, claim it, resolve it with a canned
payload, re-home it to another queue, or cancel it. The whole gesture is one
scan on an iPad with a paired scanner.

The escalation surface makes this tractable. Every work item lives in a role
queue with a small set of states, a universal metadata query language, and a
canonical action surface. A scan is an **ECA rule** over that surface:

- **Event** — a code arrives from an input source.
- **Condition** — an ordered list of queries against the queue
  (role, status, availability, metadata facets).
- **Action** — the platform verb the first matching query runs.

## Contents

- [The code](#the-code)
- [Schemes](#schemes)
- [Rules and steps](#rules-and-steps)
- [Confirmation](#confirmation)
- [The fallback screen](#the-fallback-screen)
- [Executing a scan](#executing-a-scan)
- [Capture on the dashboard](#capture-on-the-dashboard)
- [Scanner setup](#scanner-setup)
- [Admin configuration](#admin-configuration)
- [The printer demo](#the-printer-demo)

## The code

A scan code encodes three parts: `version : category : target`.

| Part | Width | Meaning |
|------|-------|---------|
| version | 1 digit (1–9) | Selects the **scheme** — what the target identifies and how the code parses |
| category | 2 digits (00–99) | Selects the **rule** — what scanning this code does |
| target | scheme-defined | The value matched against the scheme's metadata facet |

`1:01:75949975930` reads: scheme 1, rule 01, target `75949975930`.

## Schemes

A scheme (one of nine version slots, `lt_config_scan_schemes`) declares:

- **`target_facet`** — the escalation metadata key the target resolves
  against (`serialNumber`, `assetTag`, `batchId`…). The physical label and
  the digital twin share this value; the scan is the join.
- **`encoding`** — how the code string parses:
  - `delimited` — text separated by a single character (default `:`), e.g.
    `1:01:SN-123`. Use with Code 128, QR, or DataMatrix labels; targets may
    be any text.
  - `fixed` — digits only with a declared target width, e.g.
    `10175949975930`. Fits UPC-A/EAN/ITF labels; a trailing check digit is
    accepted. One digit of version + two of category + `target_length`
    digits of target.

## Rules and steps

A rule (`lt_config_scan_actions`) is a friendly name — print it beside the
physical code — plus an **ordered list of steps** and a fallback. Execution
walks the steps; the first step whose query matches runs its verb and
answers.

Each step:

```jsonc
{
  "query": {
    "roles": ["printer-fleet"],        // expected queue(s)
    "status": "pending",               // pending | resolved | cancelled
    "availability": "available",       // available | claimed | mine | any
    "facets": { "state": "printing" }  // extra metadata guards
  },
  "cardinality": "first",              // first | many
  "verb": "resolve",
  "confirm": { "prompt": "…?" },       // optional user confirmation
  "params": { /* verb-specific */ }
}
```

Verbs are the canonical escalation actions:

| Verb | Effect | Params |
|------|--------|--------|
| `show-detail` | Open the item's detail page | — |
| `show-list` | Open the list filtered to all matches | — |
| `claim` / `claim-show-detail` | Atomic claim (and open) | `durationMinutes`, `metadata` |
| `release` | Release the caller's own claim | — |
| `resolve` | Atomic claim + resolve with a canned payload | `resolverPayload`, `metadata` |
| `escalate` | Create an escalation in another queue, optionally closing the located one | `targetRole`, `closeCurrent`, `escalationType`, `description`, `metadata` |
| `cancel` | Claim-as-lock, then cancel | — |

String values inside `resolverPayload` and `metadata` interpolate
`{scan.target}`, `{scan.category}`, and `{scan.scannedAt}`. Every mutating
verb stamps provenance facets onto the row it touches — `scanScheme`,
`scanCategory`, `scanActionName`, `scannedAt` — so scan-driven transitions
stay queryable.

Ordering is the power move: put the expected state first and a broad
`show-detail` last. A machine whose twin is in the wrong queue still answers
the scan — with where the twin actually is. **The scan is also a state
query.**

Mutations are atomic. Claim, resolve, and cancel ride the single-statement
by-metadata operations; the caller's role scope folds into the same SQL
filter as the step's role guard. Two people scanning the same code
concurrently produce exactly one transition — the second scan reports a
conflict or falls through to the locator step.

## Confirmation

A step carrying `confirm` locates instead of acting. The scan answers
`confirm_required` with the located escalation and a pending-action
descriptor; the dashboard opens the item's detail page and raises the
rule's prompt ("Cancel this printer's current state and send it home to
servicing?"). Confirming fires the standard per-id endpoint — the same
guarded call every other surface uses.

## The fallback screen

When no step matches, the response carries the rule's `fallback`: markdown
for the operator ("**No twin found for this serial.** Register it through
the onboarding surface…") and optionally a route to land on. The scan panel
renders the markdown; a configured route navigates.

## Executing a scan

`POST /api/scan-codes/execute` takes `{ "code": "1:01:SN-123" }` and runs
as the calling user under normal RBAC. Every terminal state is a structured
200 outcome:

| Outcome | Meaning |
|---------|---------|
| `executed` | A step matched and its action ran |
| `matched_list` | A `show-list` step matched; `escalations` + `listQuery` included |
| `confirm_required` | A confirm step located its target; `pendingAction` included |
| `no_match_fallback` | No step matched; `fallback` included |
| `unconfigured` | Unknown or disabled scheme version / category |
| `invalid_code` | The string parses under no enabled scheme |
| `forbidden` | The caller's roles bar the matched action |
| `conflict` | A concurrent actor won the row |

The endpoint is source-agnostic — anything that produces a string can drive
it: a barcode scanner, an RFID reader, a camera decode, an MCP tool
(`execute_scan_code`), or a curl.

## Capture on the dashboard

The dashboard listens for scans globally — any page, any focus state. A
scanner paired as an HID keyboard "types" its decode rapidly and finishes
with Enter; a capture-phase window listener feeds every keystroke to a burst
detector that separates scanner speed from human speed:

- Keys arriving within the **burst threshold** (default 75 ms, tunable in
  the scan panel — Bluetooth HID on iPadOS runs slower than USB wedges)
  accumulate as a candidate scan.
- The terminator submits the capture; captured keys are suppressed so they
  stay out of focused form fields.
- Modifier chords, key repeats, and `Unidentified` keys reset the machine.

Capture sources are pluggable (`dashboard/src/lib/scan-sources/`): the
keyboard wedge is one provider behind a `ScanSource` contract; an RFID or
camera provider plugs into the same dispatch pipeline.

The **scan panel** (barcode button in the header) carries a manual entry
field — type or paste a code to execute it with zero hardware — the last
scan's outcome, and the capture settings.

## Scanner setup

Any keyboard-wedge scanner works as shipped, over USB or Bluetooth HID, with
any symbology it decodes (UPC-A/EAN, Code 128, QR, DataMatrix, PDF417). The
decoded string arrives as keystrokes regardless of symbology, so `delimited`
codes print colons literally.

Two optional scanner-side settings sharpen capture:

- **Suffix** — keep the factory Enter suffix; it is the burst terminator.
- **Prefix** — program a preamble character and set the same character in
  the scan panel. With a prefix, suppression is airtight from the first
  keystroke; without one, the first character of a scan can reach a focused
  field before the burst is recognized.

Label guidance: QR or DataMatrix survive small corner labels and floor
grime best; Code 128 suits wider flat labels; `fixed` encoding packs into
UPC-A where numeric-only labels are already in circulation.

## Admin configuration

**Admin → Scan Codes** manages the nine scheme slots. A scheme's detail page
shows the 00–99 category grid; picking a slot opens the rule editor:

1. **Name it** — the friendly label printed beside the physical code.
2. **Order the conditions** — each step picks a queue, a held-by filter,
   and its action; steps reorder with arrows. First match wins.
3. **Set the fallback** — markdown for the no-match screen.

The same CRUD rides `PUT/GET/DELETE /api/scan-codes/schemes/:version[/actions/:category]`
(admin) and the admin MCP tools `list_scan_schemes`, `upsert_scan_scheme`,
`upsert_scan_rule`, `delete_scan_rule`, `execute_scan_code`. Incoherent
rules fail the write with the exact problem — an `escalate` step names its
`targetRole`, a `resolve` step carries its payload.

## The printer demo

The example seed (`examples/seed-scan-codes.ts`) configures scheme 1 over
the [printer-twin](../examples/workflows/printer-twin/) farm: the target
facet is the twin's `serialNumber`, and four rules map to the four corners
of each machine:

| Corner | Code | Rule |
|--------|------|------|
| upper-left | `1:01:<serial>` | **Send Printer Home** — cancel the twin's fleet row (confirmed); the twin escalates to its service surface |
| upper-right | `1:02:<serial>` | **Collect Print** — resolve the in-flight `printing` row as success |
| lower-right | `1:03:<serial>` | **Print Failed** — resolve the `printing` row as fail; plate cleared, machine reset |
| lower-left | `1:04:<serial>` | **Offline for Service** — cancel the fleet row and open a service item in the servicer queue |

Each rule ends on a broad `show-detail` and the "no twin found" fallback.
Walk it hardware-free: run the twin farm, open the scan panel, and paste
`1:02:<a-printing-serial>`.
