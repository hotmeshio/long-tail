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
- [Info-choice screens](#info-choice-screens)
- [Identity schemes and acting identity](#identity-schemes-and-acting-identity)
- [Station deployments](#station-deployments)
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
| version | 2 digits (10–99) | Selects the **scheme** — what the target identifies and how the code parses. Two digits so a code never starts with a leading zero. |
| category | 1 digit (0–9) | Selects the **rule** — what scanning this code does |
| target | scheme-defined | The value matched against the scheme's metadata facet |

`10:1:75949975930` reads: scheme 10, rule 1, target `75949975930`.

Both indices are assigned automatically as you add named entries — operators
name schemes and actions, never pick numbers.

## Schemes

A scheme (`lt_config_scan_schemes`, indexed 10–99) declares:

- **`target_facet`** — the escalation metadata key the target resolves
  against (`serialNumber`, `assetTag`, `batchId`…). The physical label and
  the digital twin share this value; the scan is the join.
- **`encoding`** — how the code string parses:
  - `delimited` — text separated by a single character (default `:`), e.g.
    `10:1:SN-123`. Use with Code 128, QR, or DataMatrix labels; targets may
    be any text.
  - `fixed` — digits only with a declared target width, e.g.
    `1015949975930`. Fits UPC-A/EAN/ITF labels; a trailing check digit is
    accepted. Two digits of version + one of category + `target_length`
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

## Info-choice screens

Some objects carry one code for their whole life — an item tag, an order
label. One code, many possible intents, and the right one depends on where
the object is in its journey. The `present` verb closes that gap: the step
locates the row, states its reality, and returns a configured, labeled
choice set for the human to pick from. Upper half — what is true; lower
half — what you may do about it.

```jsonc
{
  "query": { "roles": ["printer-fleet", "printer-harvest", "printer-service"] },
  "verb": "present",
  "choices": [
    { "label": "Claim & Start", "verb": "claim", "requireActingIdentity": true, "code": "CLAIM" },
    { "label": "Complete", "verb": "resolve", "requireActingIdentity": true,
      "confirm": { "prompt": "Mark this item complete?" },
      "params": { "resolverPayload": { "outcome": "complete" } } },
    { "label": "View Details", "verb": "show-detail" }
  ]
}
```

The scan answers `choices` with the located escalation and the choice list;
each choice carries `withheld: true` when its identity requirement is
unsatisfied. Picking one calls `POST /api/scan-codes/execute-choice` with a
pointer (scheme, category, step index, choice index, escalation id) — and a
pointer is never authority: the server re-reads live config, re-locates the
row under the step's query, re-applies the identity gate, and runs the verb
through the same atomic executors a direct scan uses. A row that moved on
between render and tap answers `conflict`, exactly as a lost double-scan.

A choice's `code` is a short printable token (letters, digits, underscore,
dash) enabling double-scan selection: scan the object, then scan an action
card. The station screen matches the second scan against the presented
choices before treating it as a new code.

A claim choice lands on the work: after `claim` or `claim-show-detail`
executes, the station navigates to the escalation's detail page — the same
form every operator uses to resolve, reject, or conclude the item.

**One scan, one action.** A step with exactly one confirm-less choice can
set `autoSelectSingle: true`: the scan executes the choice directly instead
of presenting a one-button screen. The worker scans the item that just
arrived at their bench and it is theirs, claimed for the configured
duration, form on screen. An unsatisfied identity requirement never
auto-fires as the wrong actor — the scan stops over at the badge screen and
completes on its own once a badge primes.

## Identity schemes and acting identity

A scheme with `kind: "identity"` is the badge layer. Its `target_facet`
names the `lt_users.metadata` key the scanned badge token matches (the demo
binds `badge_id`) — resolution is only ever that metadata equality, so a
printed username can never impersonate. Identity rules carry no steps;
their `fallback` is the unknown-badge screen.

A matching badge scan answers `identity_primed` with the person's display
name, an expiry, and an **acting grant** — an ephemeral token
(`eph:v1:acting_identity:…`) minted through the internal keystore under the
scheme's policy:

| Scheme field | Meaning |
|---|---|
| `grant_ttl_seconds` | How long the grant lives (1–86400). |
| `grant_max_uses` | `0` = TTL-bound; `n` = the grant covers n scan requests (a strict one-scan policy is `1`). |

The grant rides subsequent scans as `actingToken`. Verbs then run **as the
badged person under their own live RBAC** — the grant confers attribution,
never privilege. A dead grant (expired, exhausted, revoked) is a loud
`not_primed`, never a silent execution as the device. Scanning the next
badge replaces the session's grant; passing `previousActingToken` revokes
the outgoing one immediately.

Steps and choices opt in with `requireActingIdentity: true`: the effective
actor must be a real acting identity — a badge grant, or an authenticated
user whose own write scope covers the step. When unsatisfied, the outcome
is `not_primed` with the rule's `notPrimed` screen (a sibling of
`fallback`): the "scan your badge" message, never a silent or misattributed
action.

## Station deployments

A shared floor device (tablet + tethered scanner) signs in once as a
station account — an ordinary user with `read_scope: 'all'` and
`write_scope: 'none'` on the queues it fronts. Reads are free: the station
holds a real seat with a queue view and an audit identity. Every mutation
takes the badge layer, and `write_scope: 'none'` is the structural
backstop — even a misconfigured rule cannot mutate as the station, because
the RBAC write gate denies the account itself.

Mutations attribute to the badged person (`assigned_to`, `resolved_by`)
with the device recorded beside them (`scanStation` in the scan
provenance) — every action individually owned and geographically placed.
The dashboard's `/scan/station` route is the full-screen experience: idle
("scan your badge / scan an item"), the primed chrome with the grant
countdown, the info-choice screen, and the **badge stop-over** — the one
identity moment the flow ever surfaces. When an action needs a person and
none is primed (a withheld choice tapped, an auto-select scan, a grant that
lapsed mid-flow), the screen becomes a single clear prompt: scan your badge
to continue. The badge scan primes the session and the pending action
completes on its own. With a live grant the stop-over never appears — the
identity layer is invisible when all is well.

Badge tokens are printed credentials: seed them as long random strings,
bind them server-side (`lt_users.metadata`), and treat badge possession
with the same physical policy as any badge system. Unknown badges answer
`identity_unknown` and are auditable.

## The fallback screen

When no step matches, the response carries the rule's `fallback`: markdown
for the operator ("**No twin found for this serial.** Register it through
the onboarding surface…") and optionally a route to land on. The scan panel
renders the markdown; a configured route navigates.

## Executing a scan

`POST /api/scan-codes/execute` takes `{ "code": "10:1:SN-123" }` and runs
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

Scan surfaces are **opt-in**. The deployment turns them on with
`features.scanCodes: true` in the `start()` config (default false, like every
`features` flag surfaced through `/api/settings`); when on, every persona
gets the header scan affordance, the panel, and the global capture. The
easter-egg Features panel carries a local **Scan input** override to test
either state on one browser. The execute and config APIs work regardless —
the flag gates the dashboard surface.

When enabled, the dashboard listens for scans globally — any page, any focus
state. A scanner paired as an HID keyboard "types" its decode and finishes
with Enter; capture is **pattern-anchored**: a capture-phase window listener
accumulates keystrokes freely, and when the terminator arrives it checks
whether the recent keys end with a scan-code shape
(`[1-9][0-9]:[0-9]:target` or the digits-only fixed form).

- On a match, the terminator is swallowed, the code's characters are
  stripped back out of whatever editable held focus (byte-exact, at the
  cursor), and the code executes. Cursor focus never diverts a scan.
- Scanner pacing is irrelevant: slow Bluetooth HID links, Shift-chorded
  capitals and colons, and mid-burst stalls all capture, because nothing has
  to be recognized mid-flight. The one tunable is the **key gap limit**
  (default 500 ms in the scan panel) separating distinct typing episodes.
- Typing a valid code and pressing Enter fires it too, anywhere — that is
  the contract: the scanner is a keyboard, so the keyboard is a scanner.
- Scanners with no suffix programmed work through **quiet-period auto-fire**:
  a full code shape typed at scanner speed (avg ≤ 50 ms/key) followed by
  300 ms of silence fires without a terminator. Hand-typed codes never
  auto-fire — humans type slower than the ceiling; they submit on Enter.
- Delimited targets carry `a-z A-Z 0-9 . _ -`; lowercase is the recommended
  label vocabulary. Case is preserved — metadata matching is case-sensitive.

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

An **Enter suffix** on the scanner gives the crispest capture (the code
fires the instant the suffix arrives); scanners without one fire after the
quiet period. The scan panel's diagnostics view traces every keydown the
capture sees — the tool for pinning any scanner's stream shape.

Label guidance: QR or DataMatrix survive small corner labels and floor
grime best; Code 128 suits wider flat labels; `fixed` encoding packs into
UPC-A where numeric-only labels are already in circulation.

## Admin configuration

**Admin → Scan Codes** lists your schemes. Add a scheme, name it, and point it
at a target facet — its two-digit index is assigned for you. A scheme's detail
page lists its actions; **Add an action** opens the rule editor:

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

The example seed (`examples/seed-scan-codes.ts`) configures scheme 10 over
the [printer-twin](../examples/workflows/printer-twin/) farm: the target
facet is the twin's `serialNumber`, and four rules map to the four corners
of each machine:

| Corner | Code | Rule |
|--------|------|------|
| upper-left | `10:0:<serial>` | **Send Printer Home** — cancel the twin's fleet row (confirmed); the twin escalates to its service surface |
| upper-right | `10:1:<serial>` | **Collect Print** — resolve the in-flight `printing` row as success |
| lower-right | `10:2:<serial>` | **Print Failed** — resolve the `printing` row as fail; plate cleared, machine reset |
| lower-left | `10:3:<serial>` | **Offline for Service** — cancel the fleet row and open a service item in the servicer queue |

Each rule ends on a broad `show-detail` and the "no twin found" fallback.
Walk it hardware-free: run the twin farm, open the scan panel, and paste
`10:1:<a-printing-serial>`.
