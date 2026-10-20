# Roster (`x-lt-widget: "roster"`)

A roster lists every member a container row expects, each marked **waiting**, **in**, or **flagged**, with the count in its heading ("3 of 5 in · 1 Missing"). The person works from it: a member that arrives ticks in, an action on a member resolves its row in place, and the rest of the form can wait until every member is accounted for.

Like the other [embed widgets](x-lt-embed.md), a roster is display-only: declare it `readOnly`, keep it out of `required`, and it contributes nothing to the resolver payload.

```json
"orders": {
  "type": "string",
  "readOnly": true,
  "title": "Orders in this box",
  "description": "Scan each bag into the box. Mark a bag missing if it is not in the bin.",
  "x-lt-widget": "roster",
  "x-lt-roster": {
    "expected": { "query": { "roles": ["packing"], "facets": { "packingBox": "{{escalation.id}}" } } },
    "key": "{{metadata.orderId}}",
    "in": ["items", "resolver.bags"],
    "flagged": [
      { "when": "resolver.outcome=missing", "label": "Missing" },
      { "when": "resolver.outcome=needs-manager", "label": "With a manager" }
    ]
  },
  "x-lt-columns": [
    { "label": "Order", "value": "{{metadata.orderId}}" },
    { "label": "PO", "value": "{{metadata.po}}" }
  ],
  "x-lt-actions": [
    { "label": "Missing", "when": "waiting",
      "resolverPayload": { "outcome": "missing" },
      "confirm": "Mark {{metadata.orderId}} missing?" },
    { "label": "Send to a manager", "when": "waiting",
      "resolverPayload": { "outcome": "needs-manager" } }
  ]
}
```

## `x-lt-roster`

| Field | Description |
|-------|-------------|
| `expected` | The members the row expects. One of `query`, `list`, or `batch` (below). |
| `key` | For a `query` set: a template naming each member row's entry. Default `{{escalation.id}}`. |
| `in` | Where arrivals are read. `items` reads the row's held keys (its accumulated items, or a batch's filled keys); any other entry is a `domain.path` naming a string or an array, such as a scan field in the live form (`resolver.bags`, a field the form declares). Default `["items"]`. |
| `flagged` | Rules over each member row's own context: `when` is an [`x-lt-showIf`](x-lt-show-if.md) condition (or an array of them), `label` is the text the entry shows. The first matching rule wins. |

### Expected sets

| Set | Shape | Entries |
|-----|-------|---------|
| `query` | `{ "role": "...", "roles": [...], "facets": {...}, "status": "..." }` | Member rows matching the role(s) and facets. Facet values are `{{domain.path}}` templates over the host row. Every status is read unless `status` names one, so a member resolved as missing stays on the roster. Up to 200 rows. |
| `list` | `"metadata.members"` | The keys in an array on the host row. |
| `batch` | `true`, with optional `"labels": "envelope.boxLabels"` | The row's batch keys; a batch key is in once filled. `labels` names a per-key map whose entry each column reads as `{{item.label.*}}`. |

Stamp the container's id on each member row when the container opens (`packingBox` above). The expected set is then the container's own, and a member that joins the source later never appears on it.

### State

An entry is **in** when its key is held or appears in an `in` source, **flagged** when its member row matches a `flagged` rule, and **waiting** otherwise. In reads before flagged: a member a manager confirms into the box reads in, even though its own row was resolved as "needs a manager".

## Columns

`x-lt-columns` take the same `{ label, value, format }` entries as the [escalation list](x-lt-embed.md#x-lt-columns-optional). Values read the member row's domains for a `query` set (the host row's otherwise), beside `{{item.*}}`:

| Token | Value |
|-------|-------|
| `{{item.itemKey}}` | The entry key |
| `{{item.label.*}}` | The entry's value in a batch `labels` map |
| `{{item.payload.*}}`, `{{item.actor}}`, `{{item.at}}` | The held item, once it is in |

Without `x-lt-columns`, each entry shows its key.

## Actions

`x-lt-actions` resolve the entry's member row through the standard resolve endpoint, as the [escalation list's actions](x-lt-embed.md#x-lt-actions-optional) do: RBAC and `enforce_schema` apply, the resolve records the viewer in the row's `metadata.resolved_by`, and a refused action shows the server's reason on the entry.

| Field | Description |
|-------|-------------|
| `label` | Button text |
| `resolverPayload` | The canned payload; string leaves interpolate against the member row |
| `when` | The entry state(s) that offer the action: `"waiting"` (default), `"in"`, `"flagged"`, or an array |
| `confirm` | A confirmation asked in place, beside the entry, before firing |

An entry with no member row (a `list` or `batch` set) offers no actions.

Moving work to another person is a resolve with an outcome. "Send to a manager" above resolves the member row with `outcome: "needs-manager"`; the member's workflow opens a row in the manager's role, where only a manager can resolve it, and the manager's confirm adds the bag to the box.

## Completeness: `roster.*` and the roster guard

Each roster's counts join the form context as `roster.<field>`: `expected`, `in`, `flagged`, `waiting`, and `outstanding` (entries neither in nor flagged). [`x-lt-showIf`](x-lt-show-if.md) and help tokens read them, so the steps that follow can wait for the roster:

```json
"weight": {
  "type": "number",
  "title": "Box weight",
  "description": "Weigh the closed box.",
  "x-lt-showIf": "roster.orders.outstanding=0"
}
```

A [submit guard](x-lt-embed.md#submit-guard-x-lt-submit-guard) can name the roster. The submit stays disabled while entries are outstanding:

```json
"x-lt-submit-guard": { "roster": "orders", "message": "{{count}} orders are still unaccounted for" }
```

`{{count}}` is the outstanding count. A roster guard never auto-submits; the person finishes the steps the roster revealed.

**Enforced on both sides.** For roles that set `enforce_schema`, the server computes the same roster at resolve, from the same shared code: `roster.*` showIf conditions evaluate as the form showed them, and a resolve with an outstanding entry is refused with the guard's message as a `422`, on every surface. The server reads member rows regardless of the resolver's read scope, so a resolver who cannot see a member never clears the guard. Give the people who work the roster `read` on the member role so the list they see matches.

## Live updates

The roster reads member rows through the same list query as every list, so it refreshes on the same escalation events: a bag scanned at another station, or added from another device, ticks in without a reload. A scan into a form field ticks its entry in at once.
