# Versioned Knowledge Lookups

An escalation can pin **versioned knowledge lookups** — enumerated lists (select options, checklist items, cascade maps) that live once in the knowledge store and are referenced by thousands of rows. The refs ride the escalation; the content does not. Forms address the resolved content through the `lookup.*` context domain, so the full x-lt vocabulary works against it: `x-lt-options`, `x-lt-source`, `x-lt-showIf`, `x-lt-help`.

---

## The Ref

```json
{ "domain": "catalog", "key": "materials", "version": 2, "as": "materials" }
```

| Field | Required | Meaning |
|-------|----------|---------|
| `domain` | yes | Knowledge domain |
| `key` | yes | Entry key within the domain |
| `version` | yes | The immutable edition this escalation reads |
| `as` | no | The ref's form-context address, when the key alone is ambiguous |

`version` is required by design. A ref names an **immutable edition**, never a moving target: every escalation created against edition 2 renders edition 2 forever, however the entry evolves afterward. Refs live under the reserved `envelope.lookups` key — the unindexed, render-only bag beside `formDefaults`. They ride the engine's atomic write but never touch the GIN-indexed metadata surface: refs are form plumbing, not facets.

## Creating an Escalation with Lookups

Pass `lookups` to `conditional` — the same compile-time-literal discipline as `schemaVersion`:

```typescript
const decision = await conditional<CascadeResolverV1>(signalId, {
  role: 'catalog-picker',
  description: 'Pick a material for this order',
  lookups: [
    { domain: 'catalog', key: 'materials', version: 2 },
    { domain: 'catalog', key: 'geo', version: 1 },
  ],
  schemaVersion: 1,
});
```

The refs fold into `envelope.lookups` as a pure transform — a pinned wait costs exactly what an unpinned one does. A malformed ref (missing field, non-integer version) throws before the row is written; over the HTTP create surface the same validation answers with a 400.

## Versioning

Every knowledge entry carries a `current_version`, and every write that changes its data mints an immutable snapshot automatically — no publish step:

1. **Add items** — write the entry (`storeEntry`, `set_knowledge_field`, the dashboard editor). The data change bumps `current_version` and snapshots the new edition. Writes that leave the data unchanged mint nothing.
2. **Repin** — update the workflow's `lookups` literal to the new version, evolving the resolver payload type alongside when the new items change what the form can answer.
3. **Rows in flight keep their edition** — an escalation pinned to v1 renders v1's list even after v5 exists.

Inspect the lineage with `GET /api/knowledge/entry/versions?domain=catalog&key=materials`, `ltc kb versions catalog materials`, or the `list_knowledge_versions` MCP tool. Fetch a specific edition with `?version=N` on the entry endpoint.

## The Grant

The refs on the row ARE the grant. Any user who may read the escalation may fetch exactly the pinned editions it names:

```
GET /api/escalations/:id/lookups
→ { "lookups": [{ "domain": "catalog", "key": "materials", "version": 2, "data": { "items": [...] } }] }
```

The general knowledge API (`/api/knowledge/*`) is a builder surface — superadmin or engineer. A member never queries the knowledge store directly; the escalation-scoped endpoint serves them precisely the editions their work item carries, and nothing else. A ref whose snapshot does not exist answers with `missing: true` for that ref — the batch never fails.

## Form Addressing

The resolved refs form the `lookup` context domain, keyed by each ref's `as` (or its `key`):

```json
{
  "properties": {
    "material": {
      "type": "string",
      "x-lt-options": "lookup.materials.items"
    },
    "checks": {
      "type": "object",
      "x-lt-widget": "checklist",
      "x-lt-source": "lookup.checks.items",
      "x-lt-require-all": true
    }
  }
}
```

The entry's `data` is addressed directly — a flat option list lives at `data.items`, so the token reads `lookup.<name>.items`. Everything the context domains offer works here: `x-lt-showIf` conditions, `{{lookup.materials.items}}` in `x-lt-help`, dynamic bounds.

Option entries are scalars or `{ value, label }` objects (`{ id, label }` accepted as an alias). An object entry separates what the submitter sees from what the payload stores — a DB-backed pick list shows its text and stores its foreign key:

```json
{ "items": [
  { "value": "3f6a…", "label": "Delamination" },
  { "id": "9c2b…", "label": "Warping" }
] }
```

The select renders the labels, the submitted answer is the value, and mixed arrays resolve each entry independently (a scalar is both).

Membership is enforced on both sides of the wire: the dashboard constrains the choices, and an `enforce_schema` role's server gate re-resolves the same pinned editions and rejects an out-of-edition value with the canonical 422.

## Cascading Selects

An option path may embed `{{domain.path}}` interpolation segments — the same grammar as `x-lt-help` tokens — so one answer drives the next field's legal set:

```json
{
  "properties": {
    "country": { "type": "string", "x-lt-options": "lookup.geo.countries" },
    "region":  { "type": "string", "x-lt-options": "lookup.geo.regions.{{resolver.country}}" }
  }
}
```

With a `catalog/geo` entry shaped as:

```json
{
  "countries": ["US", "EU"],
  "regions": {
    "US": ["CA", "NY", "TX"],
    "EU": ["DE", "FR", "ES"]
  }
}
```

- **Region renders disabled** (an empty select on the explicit **Choose…** placeholder) until Country carries an answer.
- **Choosing a country enables and populates Region** with exactly that country's list — the path re-resolves against the live form on every edit.
- **Changing the country resets the presentation**: a previously chosen region that is no longer legal shows the placeholder again, and the stale value fails the membership pass on submit — client-side in the error panel, server-side as the 422 for enforcing roles.
- Chains extend naturally: C can interpolate B the same way B interpolates A, walking one nested map or several refs.

Interpolation works in `x-lt-source` the same way, so checklist item sets can follow an answer too.

A lookup-sourced checklist can declare `"x-lt-default-checked": true` to start every item checked (uncheck the exceptions). The widget applies the default when the edition resolves, so a pure escalation-minting step never needs to enumerate the item ids — see [x-lt-widget.md](x-lt-widget.md#first-load-default-x-lt-default-checked).

## Efficiency

- **Refs, not content, ride the rows.** Thousands of escalations sharing one list each store a three-field ref; the list lives once per edition.
- **One fetch per page.** The resolve UI batch-fetches all refs in a single `GET /:id/lookups` call at load. Pinned editions are immutable, so the response caches for the whole session.
- **Zero network during execution.** Cascade levels resolve locally from the already-fetched entry data — every keystroke re-resolves in memory.
- **Server-side, snapshots cache indefinitely.** Enforcement reads come from an in-process LRU keyed by `(domain, key, version)`; the first row referencing an edition pays the read, every later row hits memory.

## Reference Example

`examples/workflows/lookup-cascade/` is the canonical reference:

- `material` — select from the pinned `catalog/materials` edition; the seed mints v1 (three items) then v2 (five), and seeds one escalation pinned to each, so both editions render side by side from ONE role form
- `country` → `region` — the cascade pair over `catalog/geo`
- `checks` — checklist sourced from `catalog/checks` with `x-lt-require-all`
- the `catalog-picker` role sets `enforce_schema: true`, so out-of-edition submissions reject server-side

Invoke `lookupCascade` with `{ "data": { "materials_version": 1 } }` (or `2`) to pin either edition per run.
