# Operations

The Operations view gives anyone managing a process pipeline a live picture of how work is flowing across every station. It answers the question the COO actually asks: *are we keeping up, and where are things backing up?*

## What "operations" means

A process is a directed sequence of **stations** — each station is a role where work lands, is claimed, and gets resolved before moving downstream. The ortho manufacturing pipeline is one example: `design → review → print → grind → glue → finish → qa → ship`. Any set of roles with `parent_role` set forms a process graph.

Stations opt in to the Operations view by setting `ops_visible = true` on the role. Roles without that flag appear in the Roles admin page but not on `/operations`.

## Capacity settings

Each station has three settings that define what "healthy" looks like — knowing any two derives the third (`target_per_hour = worker_count / (sla_minutes / 60)`):

| Field | Description |
|-------|-------------|
| `sla_minutes` | Target resolution time in minutes. Items older than this are counted as `in_arrears`. |
| `target_per_hour` | Intended throughput — how many items should resolve per hour. Used to compute `throughput_pct` and the station's expected count on the pace chart. |
| `worker_count` | Capacity at this station — number of staff or machines expected to be active. |

These are set via `PATCH /api/roles/:role` or the Roles admin page.

## Pace chart

The chart is the centrepiece. It plots **absolute counts for the selected window** across the pipeline — every station in dependency order (parent before children, breadth-first) on the X axis.

Two lines cross the stations:

- **Target** — a straight red polyline at each station's expected count for the window (`target_per_hour × window hours`; e.g. 22/h over 15m ≈ 5).
- **Actual** — a smooth curve through each station's resolved count for the window, with a light area fill beneath it. Reading actual against target shows at a glance which stations are keeping pace.

Each station appears as a circle on the actual curve, colored by its pace ratio (`actual / target`):

- **Green** — met or beat the target (ratio ≥ 1.0).
- **Amber** — behind (ratio ≥ 0.6).
- **Red** — well behind (ratio < 0.6).
- **Grey** — target unset for this station.

Circle radius grows modestly with resolved volume. Hovering a circle shows a tooltip with the actual count, target, queue depth, and active claims. A separate indigo dot marks each station's **active** (claimed) count.

Below each circle, a three-number strip shows the live state:

```
  5↑  ·  2●  ·  12✓
```

- `↑` pending (amber when > 0)
- `●` active / claimed (indigo when > 0)
- `✓` resolved in period (green, bold — the "did we hit target" signal)

Stations without a `target_per_hour` still appear on the X axis — the lines have a gap there, and the tooltip prompts you to set a target rate to plot pace.

## Station table

Below the chart, a flat table lists every station with its live numbers:

| Column | Description |
|--------|-------------|
| PENDING | Items queued right now |
| ACTIVE | Items currently claimed |
| RESOLVED | Items resolved in the selected period |
| P99 WAIT | 99th-percentile queue time (created → claimed) in minutes |
| P99 WORK | 99th-percentile processing time (claimed → resolved) in minutes |
| TREND | Mini fill bar + percentage — live backlog ratio while items queue, period throughput efficiency when idle |

If a station has `in_arrears > 0`, a sub-row appears: `⚠ N items past SLA — view oldest first →`. The link opens the escalation queue sorted by `created_at` ascending, filtered to that role.

Clicking any row opens the station detail panel.

## Station detail panel

A 340 px right rail that slides open when a row or chart circle is clicked. Three sections:

1. **Identity** — role key, title, description, link to edit in Roles.
2. **Period selector** — `15m | 1h | 24h | 7d | 30d` toggle for this station only. It opens on the chart's selected window, then adjusts independently.
3. **Metrics** — pending / resolved / active counts; wait and work percentiles (P99, P50, avg); SLA target; worker count; links to the queue.

Close the panel with × or by clicking another row.

## Data source

All station metrics come from `GET /api/escalations/station-metrics?period=<period>`. The endpoint runs two queries against `public.hmsh_escalations` joined to `lt_roles` (for `sla_minutes` and `target_per_hour`): a live-counts pass over the pending backlog, and a window-bounded percentile pass over resolved rows (`PERCENTILE_CONT` in Postgres, served by the `idx_hmsh_esc_resolved_cover` index). Updates reach the page as push events — every escalation write invalidates the metrics through the Socket.IO event system.

`pending` is always the live count regardless of period. `resolved`, percentiles, and `throughput_pct` are scoped to the lookback window. See [`lt.escalations.getStationMetrics`](api/sdk/escalations.md#getstationmetrics) for the full response shape.

## Period selector

The global period toggle in the page header controls the chart and table simultaneously. The station detail panel has its own independent period toggle so you can zoom into a single station without losing the overview.

Period options: `15m`, `1h`, `24h`, `7d`, `30d`.

## Configuring a station

1. Go to `/admin/roles` and click the role.
2. Set `ops_visible = true`, `sla_minutes`, `target_per_hour`, and `worker_count`.
3. Set `parent_role` to the upstream role this station receives work from. Leave blank for root stations.
4. The role appears on `/operations` on the next refresh — settings take effect live.

## The ortho pipeline

The built-in ortho manufacturing demo registers 8 roles in sequence:

```
design → review → print → grind → glue → finish → qa → ship
```

Each stage uses `condition()` — a HotMesh atomic Leg1 write that creates an escalation and suspends the workflow in a single Postgres transaction. When an operator (or Claude agent via the `ortho_complete_stage` MCP tool) resolves the escalation, the resolve itself signals the workflow: it resumes in place and the next stage's escalation appears.

See [MCP Admin Tools — Ortho Pipeline](api/mcp/admin.md#ortho-pipeline) for the agent loop.

## Navigation

The Operations entry lives in the choreography sidebar (the left rail visible on `/operations` and `/escalations`), separate from the Admin sidebar. The `/operations` route admits admin-type users, superadmins, and engineers — the same audience the sidebar shows the entry to.
