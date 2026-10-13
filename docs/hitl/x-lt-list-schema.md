# List Schema (`x-lt-list-schema`)

The form schema formats one escalation on the detail page. A role can also own a `list_schema` that formats its whole list page — the list-page analog of the resolve form. It is opt-in and applies only when the list is scoped to exactly one role (`/escalations/available?role=<role>`, and the personal inbox at `/escalations/queue?role=<role>`). Absent, the list renders the standard engineer table; present, a rich role-authored view renders with a "Table view" toggle one click away.

The list schema is versioned independently of the form schema — a list edit never bumps the form version. Edit it at `/admin/roles/:role/list-schema`. The list always renders the latest version.

---

## Vocabulary

Every string is a markdown/text template run through the same `{{domain.path}}` token binding as `x-lt-help` (domains: `escalation | metadata | envelope | payload | resolver`, evaluated against each row). `body` strings render through the markdown renderer.

| Key | Level | Purpose |
|-----|-------|---------|
| `x-lt-layout` | schema | `"active-history"`, `"active"`, `"facet-table"`, `"facet-board"`, or `"table"` |
| `x-lt-help` | schema | Optional markdown header, interpolated with the active row |
| `x-lt-active` | schema | The live item card: `{ title, subtitle?, body?, fields?: [{ label, value }] }` |
| `x-lt-history` | schema | History column: `{ row: { title, subtitle?, meta? }, limit?, status? }` |
| `x-lt-columns` | schema | Column definitions for `facet-table` layout: `[{ label, value, format?, priority?, width? }]` |
| `x-lt-group-by` | schema | `facet-board`: the `"domain.path"` whose value identifies each entity. `facet-table`: a `"metadata.<key>"` whose rows read as one line (see [Grouped rows](#grouped-rows)) |
| `x-lt-related` | schema | `facet-table`: named related sets, a row's items or rows in other roles (see [Related sets](#related-sets)) |
| `x-lt-row-detail` | schema | `facet-table`: sections a row expands into, each listing a related set |
| `x-lt-card` | schema | `facet-board`: the per-entity card — `{ title, state?, fields?: [{ label, value, format? }] }` |
| `x-lt-row-action` | schema | The per-row action button: `{ action?, label?, durationMinutes? }` — see below |

`format: "age"` (or its spoken twin `"ago"`) on a `facet-table` column or `facet-board` field renders a timestamp as a compact age (`12m`, `3h`, `2d`) with the absolute time as its tooltip, repainted each minute — aging interim states are scannable at a glance. `format: "date"` renders the full date the dashboard uses everywhere, hoverable for the exact time; a bare ISO timestamp with no format renders the same way. Both readings of a date column are useful: age for pace, date for the record.

The `facet-table` renders at the table's dense setting: small type and tight side padding, so a row of six values fits without truncating. When no column declares a `width`, the first column holds 200px and the rest share the remainder; the row action sizes to its label.

`format: "user"` resolves a user-id token — `{{escalation.assigned_to}}` — to that person's display name. Resolution is batched: every id on a page is coalesced into one `POST /api/users/names` request returning display fields only (no secrets, scopes, or metadata), cached by id for the session and not refetched on window focus; a user edit invalidates the cache. It truncates with an ellipsis and carries the full name on hover; an unassigned row shows a quiet em dash. `assigned_to` is the claimant while the item is worked and stays as the resolver once it is resolved, so one column reads correctly across the row's whole life. The built-in table and timeline views carry this user column by default; authored templates opt in per column.

The **active** item is the first non-terminal escalation. The **history** column is lazy-loaded — a "Load full history" link fetches resolved items on demand (`status` defaults to `"resolved"`, `limit` to 25). Unknown or absent `x-lt-layout` is a safe no-op that falls back to the table.

### Row action (`x-lt-row-action`)

Every layout carries a persistent action button — the active card's CTA, a trailing button on each `facet-table` row, a footer button on each `facet-board` card. The template sets what it does:

```jsonc
"x-lt-row-action": {
  "action": "claim",         // "claim" | "view" — default "claim"
  "label": "Service",        // button text; defaults "Claim" / "View"
  "durationMinutes": 60,     // claim hold time; default 30
  "submitOnClaim": true      // claim AND submit, then transition on (see below)
}
```

`claim` is one click: the row is claimed for the template's duration and the detail page opens already claimed — the fast path for working a queue. The button renders on every row for layout uniformity; on rows past the gesture (resolved, cancelled, or under a live claim) it shows disabled at half opacity, and a rejected claim (someone else won the race) surfaces its message inline. `view` opens the detail page — for read-only templates where claiming from the list is wrong. Row and card clicks continue to navigate; the button is the deliberate gesture.

On My Escalations (`/escalations/queue`) every row is already held by the viewer, so a `claim` template renders as a View action there: the button opens the detail page with the default "View" label. Authored `view` actions keep their label.

### Start from the list — `submitOnClaim`

`submitOnClaim: true` turns the row action into a one-gesture start: the row is claimed and its form's seeded defaults are submitted, then — when the resolve spawns a follow-on born assigned to the person — the wait screen bridges to it. A "Start Harvesting" button on the list claims, submits, and lands the person on the next step, no detail-page stop in between.

The behavior itself lives on the form: the claim-and-submit and the hand-off are the form schema's [`x-lt-submit-on-claim`](./x-lt-footer.md) and [`x-lt-transition`](./x-lt-transition.md). The list action only launches that flow with the authored claim duration — so one role owns the outcome and the list template just points to it. If the seeded defaults fail validation the claim still lands and the person finishes on the detail page. Applies to claimable rows; on My Escalations the row already belongs to the viewer, so it opens as a View.

---

## Layouts

### `"active-history"` — document workflow

Use when the queue contains exactly one live item at a time and a history column is meaningful — a policy document, a looped review, a sequential approval chain.

```json
{
  "x-lt-layout": "active-history",
  "x-lt-help": "# {{metadata.title}}\nThe authoritative policy. One revision is live at a time.",
  "x-lt-active": {
    "title": "{{metadata.title}}",
    "subtitle": "Revision {{metadata.revision}} · effective {{metadata.effective_date}}",
    "body": "{{metadata.document_markdown}}",
    "fields": [
      { "label": "Owner",      "value": "{{metadata.owner}}" },
      { "label": "Claimed by", "value": "{{escalation.assigned_to}}" }
    ]
  },
  "x-lt-history": {
    "row":   { "title": "{{metadata.title}} — revision {{metadata.revision}}" },
    "limit": 25
  }
}
```

The reference: `examples/workflows/policy-document/` (role seeded by `examples/seed-policy-document.ts`) — a looped workflow keeps exactly one escalation live and each resolution folds into the next revision.

### `"active"` — current item card only

Use when there is one live item but no history view is needed — a single-request approval or a just-in-time form.

### `"facet-table"` — scannable queue

Use when the queue contains many concurrent rows and the role's context is best expressed as a table — a print farm, order queue, or batch-processing pond. Every pending escalation is a row; columns are defined by `x-lt-columns`.

```json
{
  "x-lt-layout": "facet-table",
  "x-lt-columns": [
    { "label": "Patient",  "value": "{{metadata.patientId}}" },
    { "label": "Heel cup", "value": "{{metadata.heelCup}}" },
    { "label": "PDAC",     "value": "{{metadata.pdac}}" },
    { "label": "Station",  "value": "{{metadata.station}}" },
    { "label": "Assignee", "value": "{{escalation.assigned_to}}", "format": "user" },
    { "label": "Priority", "value": "{{escalation.priority}}" },
    { "label": "Created",  "value": "{{escalation.created_at}}" }
  ]
}
```

A status dot precedes the first column automatically. ISO datetime values render as a readable relative date with a full-timestamp tooltip. Missing token values render as an em dash. Clicking any row navigates to the detail page. The table stands alone — `x-lt-help` and `x-lt-active` are ignored in this layout; totals live in the pagination bar.

Column widths follow the fixed-table model: a column with an authored `width` (any CSS width — `"40%"`, `"12rem"`) keeps it, and the rest share the remainder evenly. When no column declares a width, the first column gets 40% — the identity is nearly always the row's most important value.

The table renders through the same engine as the platform's built-in tables: padded cells, a sticky header, and a card fold at narrow widths — **a table never scrolls horizontally, it folds**. Below the fold threshold each row becomes a console card: `priority: 1` columns form the card's title line, `priority: 2` columns fold into label/value pairs, and `priority: 3` columns are dropped. Undeclared, the first column is the identity and the rest fold — declare priorities when the author knows which columns matter at a glance.

The seeded `print` role (ortho pipeline) is the reference example for this layout, including fold priorities.

Cells carry data only — the full column width belongs to the value, with the full text on hover. Refining is a **row** gesture: every row with at least one pure metadata binding (`{{metadata.key}}`) carries a magnifier that opens the refine dialog — the row's metadata-bound facts as touch-sized rows, each a toggle. Pick one or several (selections AND into one query) and drill: **Filter <role>** narrows this role's queue, **Search everywhere** spans every role, **Add to filters** merges the selection into the live filter set. A row with a single fact arrives preselected — two taps to drill.

### `"facet-board"` — entity board

Use when the rows describe **entities** (machines, stations) rather than a queue: within the current filter scope, rows group by the resolved `x-lt-group-by` value and each group renders one card from its most recent row (by `created_at`). The board reflects the scope — groups with no matching rows simply don't render.

```json
{
  "x-lt-layout": "facet-board",
  "x-lt-group-by": "metadata.fleetMachine",
  "x-lt-card": {
    "title": "{{metadata.fleetMachine}}",
    "state": "{{metadata.machineState}}",
    "fields": [
      { "label": "PO",    "value": "{{metadata.po}}" },
      { "label": "Order", "value": "{{metadata.orderId}}" },
      { "label": "Since", "value": "{{escalation.created_at}}", "format": "age" }
    ]
  }
}
```

The card's `state` renders as a status chip (a stable hue per token — commonly a subtype or a metadata state facet). The grid wraps to the viewport (wall-screen friendly). `x-lt-help` renders above the board as in `facet-table`. In the digital-twin pattern — each machine advertising one live pending row — the board is exact by construction; for wider scopes it groups the fetched page, with standard pagination beyond it.

Cards are fully interactive (`x-lt-group-by` should be a `metadata.*` path so the facet affordances apply):

- **Click** opens the group's latest row in the detail view.
- **⇧ click** adds the entity's facet to the live filter set — additive, so shift-clicking narrows the board in place and the facet chips row shows each condition with its own remove.
- **The header magnifier** opens the card's refine dialog — the entity identity plus every field bound to a pure `{{metadata.KEY}}` token, as touch-sized toggle rows. Selections AND into one query: **Filter <role>**, **Search everywhere**, or **Add to filters** (merge into the live set). The same row gesture the facet table carries, always visible — no hover required.

The reference: `examples/seed-fleet-sim.ts` — one advert per machine, a `format: "age"` "Since" field, and role default pins (see [pinned-views.md](pinned-views.md)).


---

## Related sets

A `facet-table` row is often a **container**: it holds items (an accumulator or batch row), and other rows are on their way to it. A related set names one of those collections once; columns and row details refer to it by name.

```jsonc
"x-lt-related": {
  "contents": { "source": "items" },
  "coming": {
    "source": "query",
    "query": {
      "segment": "order-prep",                              // or "roles": ["order-prep", "order-check"]
      "facets": { "destination": "{{metadata.destination}}" },
      "narrow": { "serviceLevel": "{{metadata.lane}}" },     // applies when the row has a lane
      "status": "pending"                                   // the default
    }
  }
}
```

- **`items`**: the row's held items (`envelope.accumulate_items`, or a batch row's `batch_items`). Each item reads through its own `payload` and, for a reciprocal add, through the **reciprocal row** (the item's own escalation).
- **`query`**: rows in other roles whose metadata contains the row's facets. Facet values are `{{domain.path}}` templates over the host row; a lone token keeps the value's JSON type, so a numeric facet matches a numeric facet. `roles` lists the roles in display order; `segment` names a Pace Board sequence by its first role (the chain composed with `parent_role`), so the sequence and its station titles come from the board. A host whose facets do not resolve shows an em dash and runs no query. `narrow` facets apply only when the row resolves them, so the facets drive the hierarchy: a lane (a bin carrying `lane`) looks ahead to its own service level only, a bin without lanes to its whole destination, and a grouped tub reads the union of its lanes.

A schema declares up to 4 sets; a query names up to 12 roles.

### Related columns

A column with `related` aggregates its set for each row:

```jsonc
{ "label": "Holds", "related": "contents", "aggregate": "count",
  "splitBy": "reciprocal.metadata.serviceLevel", "labels": { "standard": "Standard", "express": "Express" } },
{ "label": "Coming", "related": "coming", "aggregate": "count", "splitBy": "role" }
```

The cell reads `3 · Standard 2 · Express 1`: the count, then each split value as a chip. `splitBy` takes:

| Set | `splitBy` |
|-----|-----------|
| `items` | `payload.<path>` or `reciprocal.metadata.<key>` |
| `query` | `role` (chips in sequence order, labeled by role title) or `metadata.<key>` |

`labels` maps split values to display text. A `role` chip opens that role's list filtered to the row's facets.

### Row detail

`x-lt-row-detail` lists sections a row expands into. Each section loads when the row opens, and lists its set's rows with its own columns:

```jsonc
"x-lt-row-detail": [
  { "related": "contents", "label": "Holds", "columns": [
      { "label": "Order",   "value": "{{item.itemKey}}" },
      { "label": "Service", "value": "{{metadata.serviceLevel}}" },
      { "label": "Placed",  "value": "{{item.at}}", "format": "date" } ] },
  { "related": "coming", "label": "Coming", "columns": [
      { "label": "Order", "value": "{{metadata.orderId}}" },
      { "label": "At",    "value": "{{escalation.role}}", "format": "role" },
      { "label": "Since", "value": "{{escalation.created_at}}", "format": "age" } ] }
]
```

Item sections read `{{item.itemKey}}`, `{{item.payload.*}}`, `{{item.actor}}` and `{{item.at}}` beside the reciprocal row's domains; query sections read each related row's own domains. `format: "role"` renders a role name as its title. A sub-row opens its own row: an item's reciprocal row, or the related row. A section shows up to its `limit` rows (default 25, at most 100) with the total. The expansion folds with the table at narrow widths and inside a portal panel.

### Grouped rows

On a `facet-table`, `x-lt-group-by: "metadata.<key>"` reads every row sharing that facet as one line, expanding to its members. The list pages by groups, so a page holds whole groups and the total counts groups; a row without the facet is a group of one. Plain columns fold across a group with `group: "first" | "min" | "max" | "sum" | "count" | "distinct"` (default `first`); `min` and `max` compare numbers as numbers and instants as text, and `distinct` lists each value once ("standard, express"). Related columns merge across the group: counts and splits add. A container split finer (one bin per service level in the same tub) keeps reading as one line per tub.

Containment reads by indentation and band: an open line takes a light band; its members are rows of the same table, stepped in under it on a stronger band; a row's detail sections step in past their row on that row's band. The facets carry the hierarchy, so nothing repeats beneath the line that states it: a member leaves blank every value it shares with its group (the group line already shows it), and a detail section drops a column whose every row restates a facet the opened row carries (a lane's look-ahead needs no Service column). A section's first column always stays.

### Scope and cost

Related sets read under the viewer's own read scope, as every list does:

- An item total comes from the host row, so it shows whenever the row does. A split counts only reciprocal rows the viewer reads; when none are readable the cell shows the total with *split restricted*.
- A query set counts only roles the viewer reads in full. The roles it cannot count are named in the cell's tooltip and in each expansion (*partial*). Granting `read` on those roles is the dial that widens the view.
- A viewer who cannot read the host role gets a 404.

The server reads the declaration from the role's stored list schema at the version the page rendered, never from the request. `POST /api/escalations/related` aggregates one page of rows in one statement per declared (set, split) pair, whatever the page size or item count; a query set's facet match is served by the metadata GIN index. `POST /api/escalations/related/rows` reads one row's set for its expansion. The list refreshes the sets live: the row's own role events, and the related roles' events, refresh the counts on the list tier.

A role's list schema is validated wherever it is written (the role API, the MCP tool, the startup apply): a column naming an undeclared set, an unknown split path, or a malformed query is refused with the path that failed. Keys outside this vocabulary stay free-form.

The reference: `examples/workflows/consolidation/` (roles seeded by `examples/seed-consolidation.ts`). Orders walk two stations and are staged; containers per destination read what they hold by service level and what is coming by station. `npm run consolidation:sim` drives a floor over HTTP; `KEEP=1` leaves it mid-flight.
