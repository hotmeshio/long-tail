# List Schema (`x-lt-list-schema`)

The form schema formats one escalation on the detail page. A role can also own a `list_schema` that formats its whole list page — the list-page analog of the resolve form. It is opt-in and applies only when the list is scoped to exactly one role (`/escalations/available?role=<role>`). Absent, the list renders the standard engineer table; present, a rich role-authored view renders with a "Table view" toggle one click away.

The list schema is versioned independently of the form schema — a list edit never bumps the form version. Edit it at `/admin/roles/:role/list-schema`. The list always renders the latest version.

---

## Vocabulary

Every string is a markdown/text template run through the same `{{domain.path}}` token binding as `x-lt-help` (domains: `escalation | metadata | envelope | payload | resolver`, evaluated against each row). `body` strings render through the markdown renderer.

| Key | Level | Purpose |
|-----|-------|---------|
| `x-lt-layout` | schema | `"active-history"`, `"active"`, `"facet-table"`, or `"table"` |
| `x-lt-help` | schema | Optional markdown header, interpolated with the active row |
| `x-lt-active` | schema | The live item card: `{ title, subtitle?, body?, fields?: [{ label, value }] }` |
| `x-lt-history` | schema | History column: `{ row: { title, subtitle?, meta? }, limit?, status? }` |
| `x-lt-columns` | schema | Column definitions for `facet-table` layout: `[{ label: string, value: string }]` |

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
