# The Domain Dictionary

Every deployment runs its own ontology on top of long-tail's primitives: the
operation speaks in printers, orders, batches, and resets, while the platform
speaks in roles, queues, workflows, escalations, and metadata facets. The domain
dictionary is where that translation is declared. An agent (or a teammate) that
knows the dictionary hears "printer PRN-001" and immediately knows the query —
the roles whose rows carry it, the facet that identifies it, `created_at desc`.

The dictionary lives in the database (`lt_domain`, one row per deployment). It
declares the **semantic overlay** — jargon terms, guidance, runbooks. Structure
is **derived** from the live registries when the dictionary is read: an entity's
id facet comes from its role's `entity_facet`, a role entry carries the live
row's title and verb semantics, a workflow entry carries the live config. The
merged view is always current.

## The shape

```json
{
  "name": "acme print-farm",
  "version": "1",
  "overview": "One page: what this deployment runs.",
  "terms": [
    {
      "term": "printer",
      "aliases": ["machine"],
      "kind": "entity",
      "maps_to": { "roles": ["printer-fleet"] },
      "guidance": "A machine on the floor, keyed by serialNumber. Find one with facets={serialNumber: value}."
    },
    {
      "term": "reset",
      "kind": "action",
      "maps_to": { "verb": "cancel", "role": "print-operator" },
      "guidance": "Cancel the demand row — the dispatcher re-mints the attempt."
    },
    {
      "term": "the pipe",
      "kind": "workflow",
      "maps_to": { "workflow": "orderPipeline" },
      "id_convention": "pipe-<orderId>",
      "kill_road": "Terminate the pipe root with terminate_workflow; never cancel the demand row.",
      "guidance": "One run per order."
    },
    {
      "term": "claims expire = recovery",
      "kind": "rule",
      "guidance": "A lapsed claim returns the row to the queue. Expiry is recovery, not an error."
    }
  ],
  "runbooks": [
    { "name": "kill a test order", "steps": ["find the pipe root by id convention", "terminate_workflow on it"] }
  ]
}
```

Term kinds: `entity` (a tracked noun; `idFacet` derives from the role's
`entity_facet`, declare it only to override), `role` (jargon for a queue),
`workflow` (carries `kill_road` and `id_convention`), `facet` (a metadata key's
meaning; `values` lists a closed domain), `action` (a domain verb mapped to a
platform verb), `rule` (a standing law, stated imperatively).

## Role verb semantics live on the role

What cancel or expiry MEANS for a row class is a property of the role itself.
Declare it under the reserved `lt_roles.properties` keys — editable with the
same `PATCH /api/roles/:role` that manages every other role dial:

```json
{ "on_cancel": "reset — the dispatcher re-mints the attempt",
  "on_timeout": "the gate re-parks and keeps listening",
  "worked_by": "machines" }
```

`cancel_escalation` returns the role's `on_cancel` alongside the receipt, and
`get_domain_context` merges all three into role entries.

## Registration and editing

Seed at boot by pointing the start config at a JSON file:

```typescript
mcp: { domainDictionaryPath: 'src/longtail/domain.json' }
```

Seeding is insert-if-absent: the DB row is runtime truth, and a name/version
mismatch between file and DB logs a drift warning. Edit live with
`PUT /api/domain` (admin) — the body is `{ doc, expected_version? }`;
`expected_version` arms optimistic concurrency (409 on conflict). Writes
validate references against the live registries: unknown roles and workflows
reject with 422 naming them; unknown facet keys warn (facets are discovered
from data and may simply have no rows yet). The boot seed applies the same
checks as warnings, so host seed ordering never blocks a boot.

## The derived floor

`get_domain_context` works on every deployment, dictionary or none. The live
registries already self-describe the structure — roles carry titles,
descriptions, `entity_facet`, and verb semantics; workflow configs carry
descriptions and invocability; facet keys are discovered from data. With no
dictionary registered the tool serves that derived view (entities are named by
their facet key, e.g. `serialNumber`, and roles sharing a facet form the
entity's system). A registered dictionary adds what only humans know: the
jargon nouns and aliases, guidance, kill roads, and runbooks.

## How agents consume it

- **MCP `instructions`** carry the overview plus a compact names-only index —
  a session-sized breadcrumb pointing at the tool.
- **`get_domain_context`** (read-safe) returns the merged view: no args → the
  index; `{ topic, name }` → specific entries, where `name` matches the term or
  any alias case-insensitively and topic `term` searches every kind. Entries
  referencing a since-removed role or workflow are annotated as dangling.
- **`GET /api/domain`** serves the raw document to dashboards and scripts.
