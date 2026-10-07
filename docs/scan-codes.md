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
- [Holding an item: the bench motion](#holding-an-item-the-bench-motion)
- [Identity schemes and acting identity](#identity-schemes-and-acting-identity)
- [Station deployments](#station-deployments)
- [The fallback screen](#the-fallback-screen)
- [Executing a scan](#executing-a-scan)
- [Capture on the dashboard](#capture-on-the-dashboard)
- [Scanner setup](#scanner-setup)
- [Admin configuration](#admin-configuration)
- [The printer demo](#the-printer-demo)
- [The bag and bin demo](#the-bag-and-bin-demo)

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
  - `gtin` — manufacturer barcodes: UPC-A, EAN-13, EAN-8 and GTIN-14, as
    printed on products. The code carries no version or category; a valid
    check digit identifies it. The target is the 14-digit GTIN (a UPC-A
    `036000291452` targets `00036000291452`), `{scan.code}` keeps the code as
    scanned, and the scheme's one rule is category `0`. A deployment has at
    most one gtin scheme, and while it is enabled no enabled fixed scheme may
    accept an 8, 12, 13 or 14 digit code: the scheme write is refused, naming
    both schemes, so a digits-only code always has exactly one reading.

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
    "facets": { "state": "printing" }, // extra metadata guards
    "subtypes": ["open"]               // optional: types / subtypes the row must have
  },
  "cardinality": "first",              // first | many
  "verb": "resolve",
  "confirm": { "prompt": "…?" },       // optional user confirmation
  "params": { /* verb-specific */ }
}
```

`query.types` and `query.subtypes` narrow steps that locate a row and then
act on it by id: `show-detail`, `show-list`, `present` (with any choice; each
choice writes the row shown), `hold`, `fill`, and `accumulate`
(container-locate mode narrows the container). Claim, cancel, release,
resolve and escalate steps locate by the target facet inside their atomic
statement, so the upsert refuses types/subtypes on them; to narrow one, offer
it as a `present` choice. With `availability: "mine"` each takes one entry.

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
| `accumulate` | Add the scanned item to an open accumulator escalation | `itemKey` (template), `resolverPayload`, `metadata`, `accumulate: { containerFacet, container, containerRoles, reciprocal }` |

`availability` names the claim state a step's row must be in:

| `availability` | Matches |
|---|---|
| `mine` | a row under a live claim held by the acting identity (the badged user, else the session user) |
| `available` | an unclaimed row, or one whose claim has lapsed |
| `claimed` | a row under anyone's live claim |
| `any` (default) | every row the rest of the query matches |

A `resolve` step applies it inside the atomic resolve: `mine` resolves the
actor's own claim, the most recently claimed first when there are several,
so a container scan places the item in the associate's hand even when
another item for the same container is waiting. With no matching row the step falls through.

String values inside `itemKey`, `resolverPayload`, and `metadata` interpolate
`{scan.target}`, `{scan.category}`, and `{scan.scannedAt}`. Two facet bags
extend them: `{claim.<facet>}` reads the acting user's single live claim
(one scoped query, run only when a step mentions it; zero or two live claims
make the step fall through), and `{item.<facet>}` reads the row an item-mode
`accumulate` step located. A token that cannot resolve falls through instead
of writing the literal, and the rule editor rejects `{item.…}` on any other
step. An item-first ladder therefore names the item from the claim:
`"itemKey": "{claim.itemId}"` on the container scan. Every mutating verb stamps
provenance facets onto the row it touches — `scanScheme`, `scanCategory`,
`scanActionName`, `scannedAt` — so scan-driven transitions stay queryable.

`accumulate` has two modes. With `params.accumulate.containerFacet` the
scanned target is the ITEM: the step locates the item's own pending row
through the scheme facet, reads that facet from the row (an item row carrying
`containerKey: "C-7"`), and adds the target to the pending accumulator whose
metadata carries the same value, writing the item's row as the reciprocal in
the same statement (`reciprocal: false` skips it). The container pick
considers only pending rows that carry the accumulator declaration, so a
release row sharing the facet during a pack-out is never the target.
`container` narrows the pick further:

```jsonc
"accumulate": {
  "containerFacet": "containerKey",
  "container": {
    "roles": ["packing"],         // container queues (containerRoles is an alias)
    "types": ["container"],       // escalation type
    "subtypes": ["open"],         // escalation subtype
    "facets": { "open": true }    // extra metadata guards
  }
}
```

A design that parks each item as its own accumulator in the same queue as
its container (an item's slot beside its container, both carrying
`containerKey`) declares the container's type or subtype, so the add lands in
the container and never in a sibling's slot. The item's own row is never its container. Without it the scanned target is the CONTAINER and the step
adds `params.itemKey` (a template) to it. An item with no row or no container
facet falls through to the next step; a container already holding the item
reports a conflict. When the item's row exists but no pending container
carries its facet (the previous container closed and its successor has not
parked yet), the step answers `no_open_container` with the item row, the
facet, and the rule's fallback markdown, so the station reads "Container
closing, scan again" instead of the item with no hint.

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

Some objects carry one code for their whole life — an item tag, a record
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
through the same atomic executors a direct scan uses. Every choice writes
the exact row the screen presented, by id: claim, cancel, resolve and an
escalate's `closeCurrent` re-check that row (pending, the scanned code, the
step's roles, no live claim by someone else) in the same statement, and
release releases that row when it is the actor's claim. When one code names
several pending rows, the write never lands on a different one. A row that
moved on between render and tap answers `conflict`, exactly as a lost
double-scan.

A `present` step names the facts the station states about the row with
`facts`: up to 12 labeled templates, rendered server-side against the row
(`{item.<facet>}`) and the scan tokens, shown in order. A token the row cannot
fill renders as a dash.

```jsonc
"facts": [
  { "label": "Bin", "value": "{item.binCode}" },
  { "label": "Clinic", "value": "{item.facilityName}" },
  { "label": "Bags", "value": "{item.memberCount}" }
]
```

Without `facts`, the station lists the row's metadata, leaving out the
bookkeeping a bench never acts on: scan provenance (`scannedAt`,
`scanScheme`, `scanCategory`, `scanStation`, `scanActionName`),
`resolved_by`, `schema_version`, and the accumulate and batch counters.

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

## Holding an item: the bench motion

At a bench where items go into containers, every act is one item going into
one container, or one expected item checked off a record. The motion is three scans with nothing in between: **the item, your badge, the
container**. The container scan is the act. The item scan only says which
item; the badge says who.

**`hold`** is the item scan. The step locates the row and answers `held`
with a **subject**: the code that held it, the row id, a label, an expiry,
and what to scan next. It writes nothing and spends no badge use. The
station keeps the subject (device-local, in memory) and sends it back with
the next scans as `subject: { code, escalationId }`. Scanning another item
replaces it; it lapses on its own after `ttlSeconds` (default 45).

```jsonc
{ "query": { "roles": ["packing"] }, "verb": "hold",
  "params": { "hold": { "ttlSeconds": 300, "label": "{scan.target}",
    "headline": "{item.containerCode}", "subline": "{item.locationName}",
    "expect": { "schemes": [14], "prompt": "Walk to this container and scan it.\n\n{item.labelNote}" } } } }
```

**What the station shows.** With `hold.headline` the destination leads the
screen: the headline (e.g. `{item.containerCode}`) in very large type, `hold.subline`
under it (e.g. `{item.locationName}`), the held item itself as a quieter line
above, then the `expect.prompt`. A template that renders empty drops its line,
so a row-level note such as `{item.labelNote}` appears only when the workflow
set one ("Take the new label from the printer and stick it on C-12").
Any step that writes may carry `done: { markdown }`: the copy the station shows,
large, once the write lands and until the next scan ("Place it in
**{container.containerCode}**. All good."). It reads the same bags its refusal copy
reads. A fill or an into-subject add that leaves slots open shows its done
copy under the hold; without done copy the station shows the count ("2 of 5
checked off" for a fill, "2 of 5 added" for an add).

The server trusts nothing about the subject. Each request re-parses its
code, re-reads the row under the station's read scope, requires the row to
still carry the code's target and to be pending. A subject that fails is
stale: steps that need one are skipped, and when nothing else matches the
answer is `subject_stale` with `clearSubject: true`.

**Subject steps** run only while a subject from one of `subject.schemes` is
held, and act on it. The `{subject.<facet>}` template bag reads the held
row.

| Step | What the container scan does |
|---|---|
| `accumulate` with `accumulate.from: "subject"` | The held item joins the accumulator the scan names (found by the scheme facet, narrowed by `accumulate.container`). The held row is written as the reciprocal in the same statement, so a held row parked as a one-slot accumulator completes and its workflow wakes. `params.itemKey` names the item, e.g. `{subject.itemId}`. |
| `accumulate` with `accumulate.into: "subject"` | The held row collects the scanned code (`itemKey` defaults to `{scan.target}`). Use it when the container has no row yet: the first item for a container tells the workflow which container was scanned. With `accumulate.item`, the scanned code's own pending row is written as the reciprocal in the same statement (see below). On a bounded accumulator the answer carries `progress` and the subject stays held while slots remain. |
| `fill` with `fill.into: "subject"` | One expected item is checked off: the held row is a batch whose keys are codes, and the scan fills the first open key for its code. A code expected twice is declared `<code>#1`, `<code>#2` and takes two scans; a third is refused. The answer carries `progress: { filled, total, remaining }`, the subject stays held while items remain, and the last fill completes the row. On a `gtin` scheme a refusal's `expected` lists codes as the package prints them (EAN-13, or EAN-8), not the stored 14-digit form. `fill.into: "scanned"` fills the row the scan itself names. |

**`match` and `refuse`** check the pairing before anything is written.
`match.target` lists templates the scanned target must equal (e.g.
`["{subject.containerCode}"]`); `match.facets` lists facets the located container
must share with the held row (e.g. `["containerKey"]`). A miss answers `refused`
with `refuse.markdown` rendered, and nothing is written. The copy may read
`{container.<facet>}` (the container the scan named) and `{fill.pending}`
(what a fill still expects), so the station says what is wrong and where the
item goes: "That's Acme West's container. This one goes in **C-12**." When the
write itself loses a race (the container closed, another bench took the free
container), the answer is `refused` with `refuse.conflict`, and a step that
declares `refuse.conflict` also clears the subject so the next item scan
reads fresh state. Exactly one of two racing acts wins whenever both name
the same row: the reciprocal statement writes both rows or neither.

**The item's own row on an into-subject add.** A held container that collects
item codes (a box being packed from a bin) often has items that each wait on
their own row. `accumulate.item` locates that row and writes it as the
reciprocal of the container's entry, so the two land together or not at all:

```jsonc
// 11:0, item label, while the box is held
{ "query": { "roles": ["packing"], "status": "pending" }, "verb": "accumulate",
  "requireActingIdentity": true, "subject": { "schemes": [14] },
  "match": { "target": ["{subject.memberCodes}"] },
  "refuse": { "markdown": "Not one of this bin's items.",
              "missing": "That item is not waiting to be packed." },
  "done": { "markdown": "{item.itemCode} is in. {container.accumulate_count} of {container.accumulate_max}." },
  "params": { "itemKey": "{scan.target}",
    "accumulate": { "into": "subject", "item": { "roles": ["ship"], "facets": { "shape": "consolidated" } } } } }
```

The item row is a pending accumulator whose scheme facet equals the scanned
target (a plain row carrying the same code is not a candidate: only an
accumulator can take the reciprocal entry), in `item.roles` (intersected with the actor's read scope), narrowed by
`item.types`, `item.subtypes` and `item.facets`; the held row is never a
candidate. Parked as `max: 1`, it completes in the same statement and its
workflow wakes with the container's id in `$accumulated`. No such row answers
`refused` with `refuse.missing` (or falls through without it); two answer
`conflict`. An item already placed elsewhere is refused with the box still
held, an item scanned twice into it answers `already` with the box still
held, and a live claim on the item row by someone else refuses with their
name (checked before the write; the statement itself does not re-check it). `{item.<facet>}` reads the item row in `itemKey`, the payload,
metadata and copy; `{container.<facet>}` in the copy reads the held row as the
add left it.

**One rule, several kinds of held item.** `subject.facets` makes a step
apply only while the held row carries those facet values; otherwise the step
is skipped and the next one runs. A placing bench uses it to tell an item
whose destination already has a container from one that needs a free
container: the item row carries `placement: 'assigned'` or `'unassigned'`, and
the container label's rule has one step for each.

```jsonc
// 14:0, container label
[
  { "verb": "accumulate", "requireActingIdentity": true,
    "subject": { "schemes": [11], "facets": { "placement": "assigned" } },
    "match": { "target": ["{subject.containerCode}"] },
    "refuse": { "markdown": "That's {container.locationName}'s container. This one goes in **{subject.containerCode}**." },
    "params": { "itemKey": "{subject.itemId}",
      "accumulate": { "from": "subject", "container": { "types": ["container"], "subtypes": ["open"] } } } },
  { "verb": "accumulate", "requireActingIdentity": true,
    "subject": { "schemes": [11], "facets": { "placement": "unassigned" } },
    "match": { "target": ["{subject.offeredContainers}"] },
    "refuse": { "markdown": "Choose a free container: {subject.offeredContainers}.",
                "conflict": "That container was just taken. Scan the item again.",
                "missing": "That container was just taken. Scan the item again." },
    "params": { "itemKey": "{subject.itemId}",
      "accumulate": { "from": "subject", "container": { "types": ["container"], "subtypes": ["free"] } } } },
  { "query": { "roles": ["packing"] }, "verb": "present", "choices": [ /* Close this container, View container */ ] }
]
```

The workflow stamps the containers it offers on the item row (`offeredContainers`). A
`match.target` entry that is a lone token naming a list facet allows every
entry, so any offered container takes the item and any other is refused with
the offer listed. A free container is a `max: 1` accumulator row, so of two
items racing for one free container exactly one lands; the other is refused with the
conflict copy. `refuse.missing` covers an offered container with no open row (taken
a moment ago): the scan is refused instead of falling through to the next
step. The third step has no subject gate: scanning a container with no item
held offers to close it.

Someone else's live claim on the held row refuses the act with their name
(`subject.claimedByOther: "allow"` lifts this). An item already in the
scanned container answers `executed` with `already: true`, and nothing is
written twice.

The badge can come before the item or between the item and the container. A
container scan that needs a badge answers `not_primed` with
`replayable: true`; the station keeps the subject, asks for the badge, and
replays the container scan once the badge primes.

Subject steps sit beside the steps a rule already has: with no subject held
they are skipped, so the same rule keeps working for scans made without the
item scan first.

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
| `grant_max_uses` | `0` = TTL-bound; `n` = the grant covers n acts (a strict one-act policy is `1`). |
| `grant_scope` | `action` (default): each act spends one use. `subject`: the first act binds the grant to the held subject; further acts on that subject spend nothing, and the grant acts on no other subject. One badge then covers one item's whole motion (every part checked off one record) and never carries to the next item. |

**The station decides the policy.** One printed badge works at every bench,
but benches want different policies: a workstation grants one act per badge
scan (claim, then submit, takes two scans), a high-volume placing bench grants
ten minutes of acts. A role may declare its stations' policy in `properties.badge_grant`:

```jsonc
"properties": { "kiosk": true, "badge_grant": { "ttl_seconds": 600, "max_uses": 0 } }
```

A badge scanned on a device signed in as a member of that role mints under
it; fields left out keep the badge scheme's values (`scope` is the role's
`grant_scope`). A device that belongs to several roles with different
policies uses the role it is locked to (the dashboard sends its kiosk role as
`stationRole` with every scan); with no role policy, or no way to choose
between several, the badge scheme's own policy applies. The policy is
validated where the role is written: an unusable `badge_grant` is a 400 from
the role API and fails a code-owned role's startup apply. The role page edits
it under **Members → Badge at this station**.

A grant is spent by **acts**, not by looking. A scan that shows, presents,
holds, or refuses reads the grant without spending it; a mutating verb spends
one use just before it writes, and a write that does not land (the step
falls through, the scan is refused) gives the use back. Every scan response
that carried a grant reports `acting: { consumed, remaining, bound }`, and
the escalation work routes report the uses left in the
`X-LT-Acting-Remaining` header. The device retires its copy of the grant when
the server reports none left, or when a subject-bound grant's subject is
done; reads never carry the grant at all. A scan that comes back
`not_primed` while a grant is held drops that grant, so the next scan runs
unprimed instead of repeating the badge screen.

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

`write_scope: 'none'` is also what makes the badge challenge fire:
`requireActingIdentity` is satisfied by a badge grant **or** by a login whose
own write scope covers the step, so a write-capable base login self-satisfies
the requirement and claims/resolves as itself with no badge demanded. The
badge-every-time contract requires the read-all/write-none base login.

### Kiosk mode — the locked station viewport

A role opts in with `properties.kiosk: true` (the reserved role-property key,
set with the same `PATCH /api/roles/:role` as every other dial). When the
signed-in user is a **member of exactly that one role** — the station-login
shape — the dashboard locks the viewport: the left nav is gone entirely, the
role's escalation list is home (`/` and every other surface redirect to it),
and the session is held to the list, the escalation detail page, the role's
portals, and the scan screens (choice, badge). The list with neither a
`role` nor a `facets` filter is every queue at once, so it redirects home
too, including right after sign-in; a scan's `show-list` (narrowed by
facets) stays. A role that declares
[portals](./hitl/portal.md) lands on its first one as home instead of the list. The header toolbar and event feed remain. A user
holding more than one role, or an admin-type grant, always gets full chrome —
kiosk is for the single-role floor login, never a way to hide the product from
a real operator.

Pair kiosk with `x-lt-transition-done` on the role's form schema
(`"/escalations/available?role={{escalation.role}}&status=available"`) so a
resolve lands back on the list rather than walking browser history — see
[x-lt-transition](./hitl/x-lt-transition.md).

### The work surface — edit freely, badge at submit

On the work form, the badge belongs to the submission, not the editing. Once
an item is claimed, anyone at the bench edits the form freely: a grant is not
required to type. This is the read-only station login's surface: plain member
grants, none able to write. A login that holds its own write authority, an
operator with write scope on the queue or an admin or superadmin, is a person
and keeps the standard surface: another person's claim shows as claimed by
them, with the management verbs its RBAC allows, and no badge is asked of it. The submit is the state-changing act, so that is where the
badge is asked for. The form warns up front who the submit will act as — "When
you submit, you'll scan your badge to confirm you're <claimant>" — and the
submit opens a badge prompt naming that claimant. The resolve fires the moment
a matching badge primes; a badge that is not the claimant's is named and the
submit is held.

The gate is on **use**, not on grant lifetime. A live grant that names the
claimant and has uses left carries the submit and spends one use, as a scan
act does (release, cancel and escalate always ask); the badge prompt shows only when no such grant is held. The station
holds a grant only while it has uses left, so a single-use badge spent by the
claim makes the submit ask for a fresh tap, while a role's
`badge_grant: { ttl_seconds: 600, max_uses: 0 }` lets one badge claim and
submit for ten minutes. A grant bound to a scanned subject (`grant_scope:
"subject"`) belongs to that scan and still asks. Editing persists nothing
locally, so the identity gate sits at the one place a record actually
changes, once per change.

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

A field can take a scan while the form is open: with
[`x-lt-scan`](hitl/x-lt-scan.md), scanning a container into a claimed form
fills its container field (checked against what the record expects), and
`x-lt-scan-submit` submits once the scan fields are filled, which raises the
badge prompt. A scan no field accepts runs globally as usual.

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

`POST /api/scan-codes/execute` takes `{ "code": "10:1:SN-123" }` (plus
`actingToken` and `subject` when the station holds them) and runs as the
calling user under normal RBAC. Every terminal state is a structured 200
outcome:

| Outcome | Meaning |
|---------|---------|
| `executed` | A step matched and its action ran |
| `matched_list` | A `show-list` step matched; `escalations` + `listQuery` included |
| `confirm_required` | A confirm step located its target; `pendingAction` included |
| `no_match_fallback` | No step matched; `fallback` included |
| `no_open_container` | An item-mode `accumulate` step located the item but no pending container carries its facet; `escalation` (the item row), `container`, and `fallback` included |
| `unconfigured` | Unknown or disabled scheme version / category |
| `invalid_code` | The string parses under no enabled scheme |
| `forbidden` | The caller's roles bar the matched action |
| `conflict` | A concurrent actor won the row |
| `choices` | A `present` step located its row; `escalation` + `choices` included |
| `held` | A `hold` step located its row; `subject` included |
| `refused` | The scan was understood and not acted on; nothing written; `refusal.markdown` (and `refusal.expected`) included |
| `subject_stale` | The held subject moved on; `clearSubject: true` |
| `not_primed` | The act needs a badge; `notPrimed` included, `replayable: true` when the scan may run again once one primes |
| `identity_primed` / `identity_unknown` | A badge scan matched a person, or did not |

A step's payload rejected by the role's form schema answers `refused` with
the reason, never a raw 422.

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
whether the recent keys end with a scan-code shape. The shapes come from the
configured schemes: each delimited version's `VV:C:target`, each fixed
scheme's exact digit lengths, and for a gtin scheme a whole 8, 12, 13 or 14
digit run whose check digit holds (a leading zero is part of the code). A
code never starts inside a longer run of digits.

- **Digits-only codes fire only at scanner speed** (avg ≤ 50 ms/key). A
  typed PO number or count followed by Enter stays in its field, even when
  its digits happen to form a valid barcode.
- **An open form can take the scan first.** A field with
  [`x-lt-scan`](hitl/x-lt-scan.md) that accepts the scan's scheme is filled
  instead; every other scan, and every badge, runs globally.

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

The **header bar** runs rules without hardware: its type chip lists every
enabled rule as a Run mode, the bar shows the rule's code head (`10:1:`) ahead
of the input, and Enter composes and executes `10:1:<target>` through the same
pipeline a scanner uses. See [Search and run](dashboard.md#search-and-run).

The **scan panel** (the bar's menu footer, or the user menu) carries a manual
entry field — type or paste a whole code to execute it — the last scan's
outcome, the live barcode preview, and the capture settings.

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

## Declaring schemes in code

Schemes and their rules declare on `LTStartConfig.scanSchemes` and follow the
[code-owned configuration](code-owned-configuration.md) contract: under
`configSource: 'code'` a changed scheme or rule in code is live after the next
boot on every environment; under `'db'` (the default) the declaration seeds
once and the admin surfaces own it afterward. Per-entry `reset` overrides the
dial in either direction, covering the scheme and its rules together.

```typescript
scanSchemes: [
  {
    version: 12,
    name: 'Serial locate',
    target_facet: 'serialNumber',
    encoding: 'fixed',
    target_length: 8,
    rules: [
      { category: '1', name: 'Locate', steps: [{ verb: 'show-detail' }] },
    ],
  },
],
```

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

## The bag and bin demo

`examples/seed-scan-bins.ts` puts the bench motion on the
[rollup-bin](../examples/workflows/rollup-bin/) example. Start a `rollupBin`
with a `binKey` and a few `rollupMember` bags carrying the same `binKey`,
then at the scan station:

| Scan | Code | What happens |
|---|---|---|
| Bag | `12:0:<orderId>` | The station holds the bag and shows its bin, large |
| Badge | `11:0:<badge>` | Primes the person (before the bag works too) |
| Bin | `13:0:<binKey>` | The bag joins the bin and its own row completes; the station shows "Drop it in **bin-7**. All good." until the next scan |

Scan a different bin's label instead and the station refuses with the bag's
bin named, and nothing is written. Scan the bin before the badge and the
station asks for the badge, then places the bag on its own.
