# Code-Owned Configuration

Long-tail configuration — workflow registration profiles, roles and their
schemas, topics, MCP server definitions, agents, and the domain dictionary —
can be owned by either the database or the code that declares it. The
`configSource` dial on `LTStartConfig` decides, and every declarable entry can
override it individually.

```typescript
const lt = await start({
  database: { connectionString: dbUrl },
  configSource: 'code',        // declarations apply on every boot
  roles: ROLES,
  workers: WORKERS,
  topics: TOPICS,
  agents: AGENTS,
});
```

## The two ownership modes

**`'db'` (default).** Declarations are seeded insert-if-absent: the first boot
writes each record, and the database owns it from then on. Admins edit live
through the dashboard and APIs; when code and database disagree, boot logs a
`config drift:` warning and leaves the row alone.

**`'code'`.** Declarations are compared against the database and applied on
every boot. Code is the source of truth: a changed declaration overwrites the
stored config fields, and dashboard edits to declared surfaces are replaced at
the next deploy. An unchanged declaration is a no-op — no write, no version
bump. Records present in the database but absent from code are reported at
boot as orphans and never deleted.

Code ownership fits deployments that manage configuration through git and
CI/CD: the same declaration produces the same state in local, staging, and
production, without a database wipe. Local development that reseeds on every
`docker compose down -v` and a long-lived production database converge on
identical configuration.

### Per-entry override

Every entry accepts `reset?: boolean`, which wins over the global dial in
either direction:

```typescript
configSource: 'code',
topics: [
  { topic: 'order.created', ... },                 // code-owned (follows the dial)
  { topic: 'ops.notes', ..., reset: false },       // db-owned — admins keep editing it
],
```

The domain dictionary's override lives beside its path:
`mcp.domainDictionaryReset`.

## Per-surface semantics

| Surface | Declared via | Code-owned apply writes | Left alone (runtime state) |
|---|---|---|---|
| Workflow profiles | `workers[].config` | full profile incl. role lists (replace semantics) | task history, escalations |
| Roles | `roles[]` | declared fields only (PATCH); escalation targets replace | membership, undeclared fields |
| Topics | `topics[]` | whole catalog entry (`managed: true`) | `last_seen_at` |
| MCP servers | `mcp.serverFactories[].config` | description, tags, category, compile hints, credential providers | tool manifest, connection status |
| Agents | `agents[]` | description, status, goals, rules, domain, schedules | capabilities, metadata, run history |
| Agent subscriptions | `agents[].subscriptions` | reaction fields on (agent, topic) | `enabled` — the admin kill-switch |
| Domain dictionary | `mcp.domainDictionaryPath` | whole document (version bumps once per change) | — |
| Graph workflows | `graphWorkflows[]` | always compare-and-apply: description/schema sync, redeploy on YAML version bump | run history |

`certified` on a workflow profile is explicit-only under code ownership: an
omitted flag registers the workflow as **not** certified. (The db-owned seed
path keeps the roles/consumes derivation, so existing declarations behave as
they always have.)

## Roles: first-class declarations

`roles[]` registers roles with titles, versioned form/metadata/list schemas,
escalation targets, upstream inputs, dials, and pins:

```typescript
roles: [
  {
    role: 'finisher',
    title: 'Finisher',
    form_schema: FINISHER_FORM,          // versioned — see below
    escalation_targets: ['engineer'],
    sla_minutes: 30,
    properties: { kiosk: true },
  },
],
```

Only declared fields are ever written — an omitted field keeps whatever the
database holds, under either ownership mode. Under `'db'` the declaration is
written once when the role is first created (the role belongs to the database
afterward); under `'code'` it is diffed and applied every boot.

### Versioned schemas

Role schemas version through the same write path the dashboard uses. Applying
a declaration whose `form_schema` or `metadata_schema` differs from the stored
pair advances the role's schema version and snapshots the new pair into the
version history with the change summary `startup apply (code)`. In-flight
escalations pin the version they were created against, so the forms they
render keep working while new escalations pick up the new shape. Version
lineage only grows — an apply never rewinds or rewrites an existing version.
`list_schema` versions independently, exactly as it does from the dashboard.

## The boot report

Each surface logs one line summarizing its pass:

```
[long-tail] config apply (workflows): applied 2, unchanged 31, db-owned 0
[long-tail] config apply (roles): applied 1, unchanged 11, db-owned 0, orphans: [old-station]
```

Orphans — database records of a declared surface with no matching declaration
in code — are reported at warn level and left untouched. Removing a workflow
config, role, topic, or agent remains a deliberate act through the dashboard
or API. For roles, only rows carrying real configuration (a title or a form
schema) are orphan candidates; bare rows auto-created for foreign keys and
membership-only roles never appear. Orphan reporting for roles is skipped when
`examples: true` (the demo seeders own their roles).

## Concurrency

Concurrently booting containers serialize their configuration pass on a
dedicated advisory lock, separate from the migration lock. Single-statement
applies are also individually race-safe: every upsert carries an
`IS DISTINCT FROM` guard, so an identical declaration arriving from two
containers writes once and no-ops once.
