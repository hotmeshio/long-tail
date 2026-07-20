# List Schema (`x-lt-list-schema`)

The form schema formats one escalation on the detail page. A role can also own a `list_schema` that formats its whole list page — the list-page analog of the resolve form. It is opt-in and applies only when the list is scoped to exactly one role (`/escalations/available?role=<role>`). Absent, the list renders the standard engineer table; present, a rich role-authored view renders with a "Table view" toggle one click away.

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
| `x-lt-columns` | schema | Column definitions for `facet-table` layout: `[{ label, value, format? }]` |
| `x-lt-group-by` | schema | `facet-board`: the `"domain.path"` whose value identifies each entity |
| `x-lt-card` | schema | `facet-board`: the per-entity card — `{ title, state?, fields?: [{ label, value, format? }] }` |

`format: "age"` on a `facet-table` column or `facet-board` field renders a timestamp as a compact age (`12m`, `3h`, `2d`) with the absolute time as its tooltip, repainted each minute — aging interim states are scannable at a glance.

The **active** item is the first non-terminal escalation. The **history** column is lazy-loaded — a "Load full history" link fetches resolved items on demand (`status` defaults to `"resolved"`, `limit` to 25). Unknown or absent `x-lt-layout` is a safe no-op that falls back to the table.

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
    { "label": "Priority", "value": "{{escalation.priority}}" },
    { "label": "Created",  "value": "{{escalation.created_at}}" }
  ]
}
```

A status dot precedes the first column automatically. ISO datetime values render as a readable relative date with a full-timestamp tooltip. Missing token values render as an em dash. Clicking any row navigates to the detail page. `x-lt-help` and `x-lt-active` are ignored in this layout.

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

The card's `state` renders as a status chip (a stable hue per token — commonly a subtype or a metadata state facet). The grid wraps to the viewport (wall-screen friendly). Clicking a card opens the entity's history: the table view filtered to that facet value (`x-lt-group-by` should therefore be a `metadata.*` path). `x-lt-help` renders above the board as in `facet-table`. In the digital-twin pattern — each machine advertising one live pending row — the board is exact by construction; for wider scopes it groups the fetched page, with standard pagination beyond it.

The reference: `examples/seed-fleet-sim.ts` — one advert per machine, a `format: "age"` "Since" field, and role default pins (see [pinned-views.md](pinned-views.md)).
