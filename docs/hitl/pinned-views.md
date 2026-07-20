# Pinned Views

Task-queue personas live in a handful of exact queries — "pending harvest rows, oldest first," "everything about serial X." Every filter on the escalations list is already deep-linked in the URL (`role`, `status`, `facets`, `range`, `orderBy`, `view`, `jeopardy`); pinned views add persistence and placement: the right queries sit in the right person's nav from first login.

---

## User Preferences

Pins live in a per-user preferences store — a generic JSON document on the user record (pinned views are its first tenant, not its schema):

```
GET   /api/me/preferences            → { preferences }
PATCH /api/me/preferences            shallow top-level merge; null deletes a key
```

The merge is a single guarded statement (no read-then-write) and the document is size-capped (~32 KB → 413). Preferences carry presentation state only — URLs and UI choices, never data and never authorization. A pin to a query the user cannot read simply renders that query's normal empty state; read-scope enforcement stays where it already lives.

```json
{
  "pinnedViews": [
    { "id": "pin-x1", "label": "Needs harvesting", "url": "/escalations/available?role=fleet-servicer&facets=%7B%22machineState%22%3A%22finished%22%7D&view=table", "badge": true }
  ],
  "hiddenRolePins": ["My machines"]
}
```

## The Pinned Section

Pins render as a **Pinned** nav section: the user's own pins first, in stored order (drag to reorder, ✕ to remove), then role-provided defaults. **Pin this view** on the escalations list captures the live filter set into a new pin, prompting only for a label.

`badge: true` renders a live count beside the label using the same server-side predicate the pin opens onto (the pin's URL is parsed back into its query and counted with `limit: 1`) — so the badge and the list always agree, including `jeopardy=1` pins. Counts refresh on escalation events, and a pin whose URL isn't a countable escalations list renders without a badge.

## Role Default Pins

A role may declare `default_pins: [{ label, url, badge? }]` (edited on Role Detail → Default Pins). Members see them in their Pinned section from first login, marked as role-provided, and may:

- **Promote** — copy into their own pins (an own pin with the same label supersedes the role default)
- **Hide** — dismiss it (recorded in `hiddenRolePins`)
- **Reorder** — promote first, then drag among their own pins

Membership *is* the persona's bookmark set — no per-user setup. Duplicate labels across a user's roles collapse to the first role's pin.

## Reference Example

The `fleet-servicer` seed (`examples/seed-fleet-sim.ts`) ships a facet-board list schema, jeopardy dials, and three default pins — the board, a badged "Needs harvesting" facet query, and a badged jeopardy view — so the whole persona story is exercisable from the dashboard. The seeded `reviewer` user is a member.
