# Portals: a role's pinned views as pages

A role can declare **portals**: named matrices of pinned views, each rendered as a single page of live list panels at `/portal/<role>/<key>`. A matrix is an array of rows, each row an array of cells, each cell a pin. One row with one cell fills the page with that view. Two rows, the first holding one cell and the second three, give a full-width band over three columns. A 2x2 splits one queue by region, each cell the same role scoped to a different facet. Cells carry nothing but the pin, so everything a pin already says composes for free: the view (`view=rich`, `table`, `timeline`), facet scopes, jeopardy, link variables, and the live count.

A role carries several portals because screens serve different purposes. One shows urgent items by facility on the floor, four facilities in a 2x2. Another is the day's focus for the team, one panel per person, each named for them and scoped to their facets, so everyone sees their own list under their own name. Members choose a portal from the global menu, where the kiosk queue picker already lives, and each portal also appears as a row under the role's group in the left nav. A kiosk role lands on its first portal as home.

---

## Declaring portals

`portals` on the role: a list of `{ key, label, rows }`. `key` is a short url-safe slug, unique within the role, and the portal's address segment. `label` is the name shown in the menu and the nav. `rows` is the matrix: up to 4 rows of up to 6 cells, every row holding at least one cell, every cell `{ label, url, badge? }` with a dashboard-relative `url`, the `default_pins` shape.

```typescript
roles: [
  {
    role: 'printer-fleet',
    portals: [
      {
        key: 'floor',
        label: 'Floor screen',
        rows: [
          [{ label: 'Fleet board', url: '/escalations/available?role=printer-fleet&view=rich' }],
          [
            { label: 'North', url: '/escalations/available?role=printer-fleet&facets=%7B%22facility%22%3A%22north%22%7D&view=table', badge: true },
            { label: 'South', url: '/escalations/available?role=printer-fleet&facets=%7B%22facility%22%3A%22south%22%7D&view=table', badge: true },
            { label: 'Harvest queue', url: '/escalations/available?role=printer-harvest&view=table', badge: true },
          ],
        ],
      },
      {
        key: 'focus',
        label: 'Focus of the day',
        rows: [[
          { label: 'Jim', url: '/escalations/available?role=printer-fleet&facets=%7B%22owner%22%3A%22jim%22%7D' },
          { label: 'Sally', url: '/escalations/available?role=printer-fleet&facets=%7B%22owner%22%3A%22sally%22%7D' },
          { label: 'Anu', url: '/escalations/available?role=printer-fleet&facets=%7B%22owner%22%3A%22anu%22%7D' },
        ]],
      },
    ],
  },
],
```

### Counts above the panels

A portal may lead with **counts**: `counts` is a list of `{ label, url, blurb? }` (up to 8). Each becomes a tile above the panels showing the live total of its list URL, the same number a pin badge carries, under the label and over the blurb, and the tile opens the list. A queue's counts read at a glance before its lists do:

```typescript
{
  key: 'review-desk',
  label: 'Review desk',
  counts: [
    { label: 'Waiting', url: '/escalations/available?role=reviewer', blurb: 'Unclaimed items in the queue' },
    { label: 'In progress', url: '/escalations/available?role=reviewer&status=claimed', blurb: 'Claimed and being worked' },
    { label: 'Resolved', url: '/escalations/available?role=reviewer&status=resolved', blurb: 'Closed out by a reviewer' },
    { label: 'Expired', url: '/escalations/available?role=reviewer&status=expired', blurb: 'Timed out before anyone acted' },
    { label: 'Cancelled', url: '/escalations/available?role=reviewer&status=cancelled', blurb: 'Withdrawn by the workflow' },
  ],
  rows: [[
    { label: 'Waiting', url: '/escalations/available?role=reviewer&view=table&layout=compact', badge: true },
    { label: 'In progress', url: '/escalations/available?role=reviewer&status=claimed&view=table&layout=compact', badge: true },
  ]],
}
```

The `reviewer` role in the examples' start config (`index.ts`) declares exactly this portal, in code, with `reset: true` so it applies on every boot.

The same field rides `PATCH /api/roles/:role` and the `update_role` MCP tool. `null` clears every portal. Under code-owned configuration the declaration is compared in order and applied on every boot, so reordering portals or rows is a change.

## Composing them in the dashboard

Role Detail carries a **Portal** section listing the role's portals. The editor draws what it produces: each portal a bounded sheet with a title band, each cell its own small panel, and dashed placeholders wherever a view can be added. Edits build the page's draft; **Save** writes them with the rest of the role, one `PATCH` into the role's `portals` column:

- **New portal**: type a name, then **Start it with a view** over the role's default pins and the admin's own pins. The first pick creates the portal; its key derives from the name. **Label and URL** adds a view that is not yet pinned.
- Each portal shows a sketch of its shape, its editable name, its key, **Open**, and a remove control. Each row lists its cells with an editable panel title (name a cell for the person or place it serves), the view its URL asks for (`rich`, `table`, `timeline`, or `default` when the role's list schema decides), the URL, and the device binding of any link variable it references.
- Each row ends with **Add a view to this row** (up to six); below the matrix, **Start a new row with a view** (up to four rows). Removing the last cell of a row removes the row; removing the last cell of a portal removes the portal.
- A **counts** strip leads each portal's body: **Add a count** picks a pin whose total becomes a tile; each tile's title and blurb edit in place.

## The page

A portal page fills the content area with one grid row per declared row, each dividing its width evenly among its cells. Each panel is a bounded sheet with a tinted title band and its own scroll, drawn with the same components as the escalations list: the rich view when the role owns a non-table list schema and the pin does not ask for another, the table when it asks for one or the schema is plain, the timeline when asked. Count tiles, when declared, sit in one row above the panels: label, large number, blurb, each a link to its list. The band of every panel shows the pin's label, the live total, a view toggle (table or rich, when the role offers both), the sort direction, a refresh, and a link to the full view. The toggle and sort hold for the visit; the pin stays as authored. Rows open the item detail page, which returns to the portal. Up to 25 rows render per panel, then a quiet "N more in the full view" link. A narrow window stacks the cells in declaration order.

**Fitting a screen.** A panel on a wall screen is read, not scrolled, so a pin can ask the table to spend its width tightly: `?view=table&layout=compact` keeps the table a table however narrow the panel, tightens every cell, and holds the non-identity columns (assignee, role, priority) back until the panel is wide enough, so a narrow cell reads as a tight list of item and age and twenty rows fit where the folded layout showed four. `layout=cards` asks for the folded console-card layout on purpose. Without `layout`, the table folds on its own below the card threshold. The hint rides the URL like `view`, so it works on the full list page too, and it is the seam for a compact timeline later: a series of tight offset lines that fit the whole story in the panel.

A portal page shows without the left nav, as kiosk does: it is a screen read from across a room, and the panels are the page. The header stays, so the user menu still switches portals. Any signed-in user may open a portal. Panels read through the same role-scoped endpoints as the list page, so RBAC is unchanged: each viewer sees exactly what their read scope returns, and a queue outside it renders empty. Link variables resolve per device at render time, exactly as pins in the nav do. One event subscription per queue named by the cells keeps every panel current, on the LIST refresh tier.

## Choosing a portal

The global menu (the user menu in the header) lists **Portals**: every portal of the roles the viewer belongs to, grouped by role when more than one role declares any; global viewers see every role's. A device dedicated to a portal, a screen on the floor, opens the menu once and lands there, the same gesture as choosing a kiosk queue. The left nav repeats each portal as a row leading the role's pinned group.

## Kiosk

Kiosk home is the role's first portal when it declares any, and the role's escalation list otherwise. The station queue picker follows the same rule. `/portal` is on the kiosk allow-list beside the list, detail, and scan screens. See [Kiosk mode](../scan-codes.md#kiosk-mode--the-locked-station-viewport).

## Reference example

The `printer-fleet` seed (`examples/seed-fleet-sim.ts`) declares two portals: **Floor screen**, the fleet board over the two facility tables and the harvest queue, and **By model**, one panel per printer model. Open Admin → Roles → printer-fleet → Portal to see them composed, and the user menu's Portals section to open either.
