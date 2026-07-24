# Embed and Navigation Widgets

Three display-only widgets that surface related information inside an escalation's resolver form without leaving the page. All three produce **no resolver payload** — they must never appear in the schema's `required` array and are always declared `readOnly: true`.

| Widget | Token | What it shows |
|--------|-------|---------------|
| `"link"` | `x-lt-href` | A named hyperlink to any dashboard view, with pre-applied deep-link query |
| `"escalation"` | `x-lt-source`, `x-lt-fields` | A single embedded escalation record, with a flexible facts panel |
| `"escalation-list"` | `x-lt-query`, `x-lt-columns` | A compact in-form list of escalations driven by a facet query |

---

## Link widget (`x-lt-widget: "link"`)

Renders a named anchor whose URL is resolved from a `{{domain.path}}` template at render time. Use it to give reviewers a one-click path to a related queue, pre-filtered to the current item.

```json
{
  "originator_queue": {
    "type": "string",
    "readOnly": true,
    "x-lt-widget": "link",
    "x-lt-href": "/escalations/available?role=rel-originator&facets={\"orderId\":\"{{metadata.orderId}}\"}",
    "x-lt-span": 2,
    "x-lt-section": "Related",
    "title": "View originator queue for this order",
    "description": "Opens the originator queue pre-filtered to this order"
  }
}
```

### `x-lt-href` (required)

A URL template string. `{{domain.path}}` tokens are interpolated using the same five domains as `x-lt-help` — `escalation`, `metadata`, `envelope`, `payload`, `resolver` — resolved against the current form's escalation context.

Paths starting with `/` navigate inside the dashboard via the React Router client. Everything else opens in a new tab with `rel="noreferrer"`.

When the URL is empty after interpolation (the template resolved to blank), the widget renders a muted "No link configured" placeholder.

### Display text

The field's `title` keyword is the link label. `description` renders as a one-line helper beneath it. If `title` is absent, `description` is used as the label.

---

## Escalation widget (`x-lt-widget: "escalation"`)

Embeds a single escalation record as a compact card. The escalation ID is resolved from the current form's escalation context via `x-lt-source`. An optional `x-lt-fields` array configures which metadata or resolver facts from the embedded record appear in the card.

```json
{
  "parent_escalation": {
    "type": "string",
    "readOnly": true,
    "x-lt-widget": "escalation",
    "x-lt-source": "metadata.parent_escalation_id",
    "x-lt-fields": [
      { "label": "Order ID", "value": "{{metadata.orderId}}" },
      { "label": "Decision", "value": "{{resolver.decision}}" },
      { "label": "Reason",   "value": "{{resolver.reason}}" },
      { "label": "Age",      "value": "{{escalation.created_at}}", "format": "age" }
    ],
    "x-lt-span": 2,
    "x-lt-section": "Related",
    "title": "Originating request",
    "description": "The escalation that created this item"
  }
}
```

### `x-lt-source` (required)

A `"domain.path"` expression — the same convention as the checklist widget — resolved against the current form's escalation context to obtain the embedded escalation's UUID. Example: `"metadata.parent_escalation_id"` reads the `parent_escalation_id` key from the row's metadata.

When `x-lt-source` resolves to nothing, or the fetched escalation is not found or is inaccessible (RBAC enforcement happens server-side), the widget renders a quiet "No linked record" placeholder.

### `x-lt-fields` (optional)

An array of `{ label, value, format? }` objects — the same shape as `x-lt-active.fields` and `x-lt-card.fields` in list schemas. The `value` strings use `{{domain.path}}` tokens, but resolved against the **embedded escalation's own data** — its `escalation` row, `metadata`, `envelope`, `payload`, and `resolver` — not the parent form's context.

Available domains for `x-lt-fields`:

| Domain | Resolves against |
|--------|-----------------|
| `escalation` | The embedded escalation's columns: `escalation.status`, `escalation.role`, `escalation.type` |
| `metadata` | The embedded escalation's metadata dict |
| `envelope` | The embedded escalation's workflow-sent envelope |
| `payload` | The embedded escalation's context payload |
| `resolver` | The embedded escalation's resolver payload |

`format: "age"` turns an ISO timestamp into a compact relative age (`12m`, `3h`).

When `x-lt-fields` is absent, the card renders only the type/status header, description, and footer.

### Card anatomy

```
 esc-type · subtype  [status]
 ─────────────────────────────
 The escalation description
 ─────────────────────────────
 Order ID    ORD-123
 Decision    Approved
 ─────────────────────────────
 rel-originator · 2h ago     Detail →
```

---

## Escalation list widget (`x-lt-widget: "escalation-list"`)

Embeds a compact, paginated-free list of escalations driven by a facet query. Use it to give reviewers visibility into sibling items — a set of pending items in a related role, filtered to the same customer, order, or any other metadata facet.

```json
{
  "sibling_items": {
    "type": "string",
    "readOnly": true,
    "x-lt-widget": "escalation-list",
    "x-lt-query": {
      "role": "rel-originator",
      "facets": { "customerId": "{{metadata.customerId}}" },
      "status": "pending",
      "limit": 5
    },
    "x-lt-columns": [
      { "label": "Order",  "value": "{{metadata.orderId}}" },
      { "label": "Status", "value": "{{escalation.status}}" },
      { "label": "Age",    "value": "{{escalation.created_at}}", "format": "age" }
    ],
    "x-lt-span": 2,
    "x-lt-section": "Related",
    "title": "Other pending items for this customer",
    "description": "Up to 5 items currently waiting in the originator queue"
  }
}
```

### `x-lt-query` (required)

A structured query object. String values inside `facets` support `{{domain.path}}` token interpolation resolved against the parent form's escalation context (the current item's data).

| Field | Type | Description |
|-------|------|-------------|
| `role` | `string` | Role queue to query |
| `status` | `string` | `"pending"`, `"resolved"`, `"cancelled"`, `"expired"` |
| `facets` | `Record<string, string>` | Metadata containment filter; string values support `{{domain.path}}` tokens |
| `available` | `boolean` | `true` — unclaimed/expired only |
| `limit` | `number` | Max rows to show (default: 5) |

The widget is disabled (shows no list and makes no API call) when neither `role` nor any facet value is set — both are required to avoid broad unbounded queries.

### `x-lt-columns` (optional)

An array of `{ label, value, format? }` — the same shape as `x-lt-columns` in list schemas. The `value` strings use `{{domain.path}}` tokens resolved against each **displayed** escalation's own context (its row, metadata, envelope, payload, resolver).

When `x-lt-columns` is absent, three default columns are used: Description, Role, Age.

`format: "age"` turns an ISO timestamp into a compact relative age.

Each row links to the escalation's detail page.

### Empty and loading states

- **Loading** — three skeleton rows are displayed.
- **Empty** — a muted "No items found" message replaces the table.

---

## Composing with other tokens

All three embed widgets compose with the standard x-lt-* vocabulary:

```json
{
  "related_link": {
    "type": "string",
    "readOnly": true,
    "x-lt-widget": "link",
    "x-lt-href": "/escalations/available?role=rel-originator&facets={\"orderId\":\"{{metadata.orderId}}\"}",
    "x-lt-span": 2,
    "x-lt-section": "Related resources",
    "x-lt-showIf": "metadata.orderId",
    "title": "Open originator queue for this order"
  },
  "parent_esc": {
    "type": "string",
    "readOnly": true,
    "x-lt-widget": "escalation",
    "x-lt-source": "metadata.parent_escalation_id",
    "x-lt-span": 2,
    "x-lt-section": "Related resources",
    "x-lt-showIf": "metadata.parent_escalation_id",
    "title": "Originating escalation"
  }
}
```

`x-lt-showIf` suppresses an embed widget when its data isn't present — use this to hide the embedded escalation when `parent_escalation_id` is absent, or hide the list when no `customerId` is in metadata.

---

## Security

RBAC is enforced server-side. The escalation and escalation-list widgets only render what the authenticated user's roles permit them to see. A widget that resolves an escalation the caller cannot access renders "No linked record" — the same response as an unknown ID — with no information leak.

The link widget generates a client-side URL; the queue it points to applies its own RBAC when the user navigates there.

---

## Example workflow

The `examples/workflows/related-escalations/` workflow demonstrates all three widgets in a realistic two-stage review scenario. See `forms.ts` in that directory for the complete form schema.
