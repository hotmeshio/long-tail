# Operations

Operations gives anyone managing a process pipeline a live picture of how work is flowing across a segment of roles. It answers the question the COO actually asks: *are we keeping up, and where are things backing up?* It surfaces as two boards that share one selector:

- **Pace Board** (`/pace`) — actual-vs-target throughput across a segment of roles.
- **Trend Board** (`/trends`) — the entity lens: where an entity's time goes across the roles that handle it.

`/operations` redirects to `/pace`.

## What Operations means

A process is a directed sequence of **roles** — each a queue where work lands, is claimed, and gets resolved before moving downstream. The ortho manufacturing pipeline is one example: `design → review → print → grind → glue → finish → qa → ship`. Any set of roles with `parent_role` set forms a process graph.

A role opts onto the boards by setting `ops_visible = true` (Role Detail → Pace Board → **Show this role on the Pace Board**). Roles without that flag appear in the Roles admin page but not on the boards.

## Capacity settings

Each role has three settings that define what "healthy" looks like — knowing any two derives the third (`target_per_hour = worker_count / (sla_minutes / 60)`):

| Field | Description |
|-------|-------------|
| `sla_minutes` | Target resolution time in minutes. The default age threshold for the priority count. |
| `target_per_hour` | Intended throughput — how many items should resolve per hour. Used to compute `throughput_pct` and the role's expected count on the pace chart. |
| `worker_count` | Capacity at this role — number of staff or machines expected to be active. |

These are set via `PATCH /api/roles/:role` or the Roles admin page.

## Jeopardy count

Every role carries one age signal: `priority_count`, the number of **pending, unclaimed** items older than the role's threshold — its jeopardy. It is deliberately a count, not a re-sorted queue — the floor rebalances coarsely, pulling the counted items to the front of the rack, rather than continuously re-ordering everything.

Two per-role dials shape it, each with a fallback so the count works from `sla_minutes` alone:

| Dial | Description |
|------|-------------|
| `priority_facet` | `lt_escalations.metadata` key holding each item's age origin as an ISO 8601 UTC timestamp (e.g. `authorized_at`, the date the order was authorized). Blank = age from `created_at`. When set, items missing the key or holding an unparseable value are not counted. |
| `priority_threshold_minutes` | Max age before an item counts as jeopardy. Blank = the role's `sla_minutes`. |

Claimed items are excluded — they are already in someone's hands; the count is what still needs pulling forward. On the board the count renders as a jeopardy action on the role (a warning triangle); clicking it opens the role's queue filtered to `jeopardy=1`, ordered oldest-first by the same facet, so the counted items sit at the top.

## Pace chart

The chart is the centrepiece. It plots **absolute counts for the selected window** across the segment — every role in dependency order (parent before children) on the X axis.

Two lines cross the roles:

- **Target** — a muted-gray dashed polyline at each role's expected count for the window (`target_per_hour × window hours`; e.g. 22/h over 15m ≈ 5).
- **Actual** — a smooth green curve through each role's resolved count for the window, with a light area fill beneath it. Reading actual against target shows at a glance which roles are keeping pace.

Each role appears as a circle on the actual curve, its radius growing modestly with resolved volume; the selected role gets a ring. Beneath the curve, the live queue shows as two faint stacked bands — **claimed/worked** (orange) and **waiting/unclaimed** (sky). A `lin | log` toggle switches the Y axis (log by default, so small and large queues stay legible together).

Roles without a `target_per_hour` still appear on the X axis — the target line has a gap there, and the tooltip prompts you to set a target rate to plot pace.

## Role table

Below the chart, a flat table lists every role with its live numbers. Columns in order:

| Column | Description |
|--------|-------------|
| NAME | The role's display title. |
| ROLE | The role id (wide viewports). |
| TARGET/H | Intended throughput — edit inline. |
| SLA/M | SLA in minutes — edit inline. |
| WORKERS | Derived capacity — `target ÷ (60 ÷ sla)`. |
| PENDING | Items queued right now — links to the available queue. |
| CLAIMED | Items currently claimed — links to the claimed queue. |
| RESOLVED | Items resolved in the selected period — links to the resolved queue. |
| P99 WAIT | 99th-percentile queue time (created → claimed) in minutes (wide viewports). |
| P99 WORK | 99th-percentile processing time (claimed → resolved) in minutes (wide viewports). |
| MIX | A time-in-state bar for the role's current items. |
| TREND | Mini fill bar + percentage — the pending-to-target ratio (amber above 1.0, gray below 0.2, green between). |
| ACTIONS | View queue, configure, and a jeopardy count when the role has aging unclaimed work. |

The three status columns carry the chart's hues as faint tints. The jeopardy action links to the escalation queue filtered to that role, `jeopardy=1`, ordered oldest-first by the role's priority facet (`created_at` when none is configured), so the counted items sit at the top.

Clicking any row opens the role detail panel.

## Role detail panel

A right rail that slides open when a row or chart circle is clicked. It carries:

1. **Identity** — role key, title, description, link to edit in Roles.
2. **Period selector** — a `15m | 1h | 24h | 7d | 30d` toggle for this role only. It opens on the board's selected window, then adjusts independently.
3. **Metrics** — pending / resolved / claimed counts; wait and work percentiles (P99, P50, avg); SLA target; worker count; the time-in-state mix and per-entity timelines inline; links to the queue.

Close the panel with × or by clicking another row.

## Trend Board (the entity lens)

The [combined board selector](dashboard.md#pace-board) offers, alongside the Pace Board segments, one **lens** per entity facet the visible roles declare, labeled `by <key>` (e.g. `by serialNumber`). Choosing a lens navigates to the Trend Board (`/trends`), the active lens deep-linked as `?lens=<key>`. The Trend Board is entity-first: roles sharing the facet form the entity's **system**, and each role contributes states per its `entity_state_source`. Three tiers, aggregate → individual:

- **Where the time went** — how the system's time splits across states over the selected period: a ranked-bar legend by total dwell beside an insight (the leader's share as a headline percentage, `<state> is the biggest time sink`, and `across N stages · M <entity> in queue now`).
- **Slice by** — the same split per value of any metadata key (`?slice=<key>`, e.g. `model` → `p1s` vs `h2s`), as small-multiple columns ranked by dwell; `?sliceValue=<value>` focuses one value with a paginated entity list.
- **The entity table** — one row per entity, ranked by tracked time: the entity value, its current state, its own dwell band, its total tracked time, and a timeline action. `?entity=<value>` opens that entity's cross-queue interval timeline in the right panel; `?find=<prefix>` prefix-filters the list.

The lens is driven by two dials on the role's Pace Board section ([Role Detail](dashboard.md#role-detail)):

| Dial | Description |
|------|-------------|
| `entity_facet` | The `lt_escalations.metadata` key naming the entity that moves through the role (e.g. `serialNumber`, `orderId`). Roles sharing a key form that entity's system. Blank = the role has no entity notion. |
| `entity_state_source` | How the role names the entity's state: **Role** (`'role'` — being in this role is one state, e.g. a servicing queue) or **Subtypes** (`'subtype'` — the one role holds several states named by each escalation's subtype, e.g. a fleet role parking `idle` / `printing`). Default `'role'`. |

The band tiers are counts-only aggregates, readable by any login while the public board flag stands; the slice and per-entity tiers group by facet values and require full (`read_all`) access to the system's queues. Data comes from `POST /api/escalations/aggregate-by-facets` and `POST /api/escalations/timeline-by-facet` — see [escalation-analytics.md](escalation-analytics.md) for the query contract.

## Data source

All station metrics come from `GET /api/escalations/station-metrics?period=<period>`. The endpoint runs two queries against `public.hmsh_escalations` joined to `lt_roles` (for the priority dials and `target_per_hour`): a live-counts pass over the pending backlog, and a window-bounded percentile pass over resolved rows (`PERCENTILE_CONT` in Postgres, served by the `idx_hmsh_esc_resolved_cover` index). Updates reach the page as push events — every escalation write invalidates the metrics through the Socket.IO event system.

`pending` is always the live count regardless of period. `resolved`, percentiles, and `throughput_pct` are scoped to the lookback window. See [`lt.escalations.getStationMetrics`](api/sdk/escalations.md#getstationmetrics) for the full response shape.

## Period selector

The period toggle in the page header controls the chart and table together. It is deep-linked as `?period=` (the `1h` default stays out of the URL for clean links) and carries across a Pace↔Trend switch. The role detail panel has its own independent period toggle so you can zoom into a single role without losing the overview.

Period options: `15m`, `1h`, `24h`, `7d`, `30d`.

## Scoping the board

When your roles declare [link variables](faceted-routing.md#link-variables), a scope pill sits in the board header. Its value is your **device binding** — the same one that scopes your role pins — so binding `facility = north` once (avatar menu → Link variables, or the pill itself) narrows the whole board to that facet: the role counts, the "where the time went" mix, and every entity timeline all reflect only matching rows. The pill shows the active scope (`facility = north`) or `All` when nothing is bound; clearing the binding restores the full board.

The scope is a metadata `@>` filter (`GET /api/escalations/station-metrics?...&facets={"facility":"north"}`), applied on top of role scope — it narrows within what you may already see, never widens it. The value picker's choices come from `GET /api/escalations/facet-values?key=<facet>` (the distinct values present in your visible rows).

## Configuring a role onto the board

1. Go to `/admin/roles` and click the role.
2. In the Pace Board section, turn on **Show this role on the Pace Board** and set `sla_minutes`, `target_per_hour`, and `worker_count`.
3. Set **Prior Step** (`parent_role`) to the upstream role this role receives work from. Leave blank for a segment root.
4. The role appears on `/pace` on the next refresh — settings take effect live.

## The ortho pipeline

The built-in ortho manufacturing demo registers 8 roles in sequence:

```
design → review → print → grind → glue → finish → qa → ship
```

Each stage uses `condition()` — a HotMesh atomic Leg1 write that creates an escalation and suspends the workflow in a single Postgres transaction. When an operator (or Claude agent via the `ortho_complete_stage` MCP tool) resolves the escalation, the resolve itself signals the workflow: it resumes in place and the next stage's escalation appears.

See [MCP Admin Tools — Ortho Pipeline](api/mcp/admin.md#ortho-pipeline) for the agent loop.

## Navigation

**Pace Board** and **Trend Board** are both globally surfaced in the choreography sidebar (the Monitor section of the left rail), separate from the Admin sidebar. Both routes admit every authenticated user — the boards are aggregate counts and trends, readonly by nature. Metrics span all roles for any login while the `features.publicPaceBoard` flag (default on) stands; a deployment that sets it false (e.g. one provisioning external one-time accounts) narrows metrics back to role membership and the boards back to admin-type users and superadmins.
