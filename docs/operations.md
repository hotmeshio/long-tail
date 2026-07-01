# Operations

The Operations view gives anyone managing a process pipeline a live picture of how work is flowing across every station. It answers the question the COO actually asks: *are we keeping up, and where are things backing up?*

## What "operations" means

A process is a directed sequence of **stations** — each station is a role where work lands, is claimed, and gets resolved before moving downstream. The ortho manufacturing pipeline is one example: `design → review → print → grind → glue → finish → qa → ship`. Any set of roles with `parent_role` set forms a process graph.

Stations opt in to the Operations view by setting `ops_visible = true` on the role. Roles without that flag appear in the Roles admin page but not on `/operations`.

## The ops triangle

Each station has three dials that define what "healthy" looks like:

| Field | Description |
|-------|-------------|
| `sla_minutes` | Target resolution time in minutes. Items older than this are counted as `in_arrears`. |
| `target_per_hour` | Intended throughput — how many items should resolve per hour. Used to compute `throughput_pct` and the pressure ratio for the membrane chart. |
| `worker_count` | Capacity at this station — number of staff or machines expected to be active. |

These are set via `PATCH /api/roles/:role` or the Roles admin page.

## Membrane chart

The chart is the centrepiece. It plots **queue pressure** across the pipeline — one continuous curve connecting every station in dependency order (parent before children, breadth-first).

**Queue pressure** at a station = `pending / target_per_hour`. At 1.0 the station is exactly at baseline. Above 1.0 means backlog is building; below means capacity slack.

The 100% baseline is a horizontal dashed line. The area **below** the baseline is shaded green (healthy flow); above is shaded amber/red (pressure).

Each station appears as a circle on the curve:

- Circle radius grows with `pending` count (capped between 13 and 22 px).
- **Amber** ring — hot (pressure > 100%).
- **Orange** ring — low flow (pending > 0 but pressure < 20%, e.g. trickle with large target).
- **Green** ring — healthy active or idle with throughput data.
- **Grey** ring — idle with no resolved data in the period.

Below each circle, a three-number strip shows the live state:

```
  5↑  ·  2●  ·  12✓
```

- `↑` pending (amber when > 0)
- `●` active / claimed (indigo when > 0)
- `✓` resolved in period (green, bold — the "did we hit target" signal)

A second dotted curve traces **throughput efficiency** (`resolved / (target_per_hour × hours) × 100`) across the period. An efficiency label annotates the right end of the dotted curve; a pressure label annotates the right end of the solid curve.

Stations with no `target_per_hour` still appear on the X axis — the curve has a gap there. The label `"no target"` renders below that station point.

## Station table

Below the chart, a flat table lists every station with its live numbers:

| Column | Description |
|--------|-------------|
| PENDING | Items queued right now |
| ACTIVE | Items currently claimed |
| RESOLVED | Items resolved in the selected period |
| P99 WAIT | 99th-percentile queue time (created → claimed) in minutes |
| P99 WORK | 99th-percentile processing time (claimed → resolved) in minutes |
| PRESSURE | Mini fill bar + percentage |

If a station has `in_arrears > 0`, a sub-row appears: `⚠ N items past SLA — view oldest first →`. The link opens the escalation queue sorted by `created_at` ascending, filtered to that role.

Clicking any row opens the station detail panel.

## Station detail panel

A 340 px right rail that slides open when a row or chart circle is clicked. Three sections:

1. **Identity** — role key, title, description, link to edit in Roles.
2. **Period selector** — independent `1h | 24h | 7d | 30d` toggle for this station only.
3. **Metrics** — pending / resolved / active counts; wait and work percentiles (P99, P50, avg); SLA target; worker count; links to the queue.

Close the panel with × or by clicking another row.

## Data source

All station metrics come from `GET /api/escalations/station-metrics?period=<period>`. The endpoint queries `lt_escalations` (the view over `hmsh_escalations`) joined to `lt_roles` to read `sla_minutes` and `target_per_hour`. Percentiles use `PERCENTILE_CONT` in Postgres.

`pending` is always the live count regardless of period. `resolved`, percentiles, and `throughput_pct` are scoped to the lookback window. See [`lt.escalations.getStationMetrics`](api/sdk/escalations.md#getstationmetrics) for the full response shape.

## Period selector

The global period toggle in the page header controls the chart and table simultaneously. The station detail panel has its own independent period toggle so you can zoom into a single station without losing the overview.

Period options: `15m`, `1h`, `24h`, `7d`, `30d`.

## Configuring a station

1. Go to `/admin/roles` and click the role.
2. Set `ops_visible = true`, `sla_minutes`, `target_per_hour`, and `worker_count`.
3. Set `parent_role` to the upstream role this station receives work from. Leave blank for root stations.
4. The role appears on `/operations` immediately — no restart needed.

## The ortho pipeline

The built-in ortho manufacturing demo registers 8 roles in sequence:

```
design → review → print → grind → glue → finish → qa → ship
```

Each stage uses `conditionLT` — a HotMesh atomic Leg1 write that creates an escalation and suspends the workflow in a single Postgres transaction. When an operator (or Claude agent via the `ortho_complete_stage` MCP tool) resolves the escalation, the workflow automatically resumes and the next stage's escalation appears. No manual signal call required.

See [MCP Admin Tools — Ortho Pipeline](api/mcp/admin.md#ortho-pipeline) for the agent loop.

## Navigation

The Operations entry lives in the choreography sidebar (the left rail visible on `/operations` and `/escalations`). It is separate from the Admin sidebar — operations access is gated on having at least one role, not builder access.
