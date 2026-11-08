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

The domain dictionary's override lives beside its declaration:
`mcp.domainDictionaryReset`.

## Per-surface semantics

| Surface | Declared via | Code-owned apply writes | Left alone (runtime state) |
|---|---|---|---|
| Workflow profiles | `workers[].config` | full profile incl. role lists, `input_schema`, and `input_lookups` (replace semantics) | task history, escalations |
| Roles | `roles[]` | declared fields only (PATCH); escalation targets replace | membership, undeclared fields |
| Topics | `topics[]` | whole catalog entry (`managed: true`) | `last_seen_at` |
| MCP servers | `mcp.serverFactories[].config` | description, tags, category, compile hints, credential providers | tool manifest, connection status |
| Agents | `agents[]` | description, status, goals, rules, domain, schedules | capabilities, metadata, run history |
| Agent subscriptions | `agents[].subscriptions` | reaction fields on (agent, topic) | `enabled` — the admin kill-switch |
| Scan schemes | `scanSchemes[]` | whole scheme + its rules + its label templates (one ownership unit; `enabled` is declarative here) | the label ledger |
| Domain dictionary | `mcp.domainDictionary` (inline) or `mcp.domainDictionaryPath` | whole document (version bumps once per change) | — |
| Graph workflows | `graphWorkflows[]` | always compare-and-apply: description/schema sync, redeploy on YAML version bump | run history |
| Machine lines | `machines.lines[]` | the whole line definition (`lt_machine_lines`; version bumps once per change) | lines declared through the API, their bot accounts, their rows |

`certified` on a workflow profile is explicit-only under code ownership: an
omitted flag registers the workflow as **not** certified. (The db-owned seed
path keeps the roles/consumes derivation, so existing declarations behave as
they always have.)

## Roles: first-class declarations

`roles[]` registers roles with titles, versioned form/metadata/list schemas,
escalation targets, upstream inputs, dials, pins, and portals
(`portals`, named matrices of pin cells, each rendered as one page):

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

## Scan schemes: scheme + rules as one unit

A scan scheme and its rules declare together — a rule cannot exist without its
scheme, so the pair is the ownership unit and one `reset` covers both:

```typescript
scanSchemes: [
  {
    version: 12,
    name: 'Serial locate',
    target_facet: 'serialNumber',
    encoding: 'fixed',
    target_length: 8,
    rules: [
      { category: '1', name: 'Locate', steps: [{ verb: 'show-detail' }] },
    ],
  },
],
```

The scheme applies before its rules so rule validation sees the scheme's kind.
Rules present in the database but absent from a code-owned scheme's
declaration are reported as `version/category` orphans. The pass runs whether
or not the dashboard scan affordances (`features.scanCodes`) are enabled —
declaring schemes states intent.

## Machine lines

Lines ([machines](machines.md#declaration)) follow the dial too. Each row of `lt_machine_lines` keeps the line's definition, who declared it (`source`: `code` from `start({ machines })`, `api` from `PUT /api/machines/lines/:siteId/:lineId`), and a `version` that advances once per change. Db-owned, a code line is inserted when absent and left as it is afterwards, with a drift warning when the declaration differs. Code-owned, a code line is written whenever its declaration differs, advancing the version once, and dashboard or API edits to it are replaced at the next deploy. Boot then runs every enabled line the registry holds, code and API lines alike, and never deletes one: a line declared in code before and not now is reported and left standing, and a line leaves the registry only through `DELETE /api/machines/lines/:siteId/:lineId`.

## The boot report

Each surface logs one line summarizing its pass:

```
[long-tail] config apply (workflows): applied 2, unchanged 31, db-owned 0
[long-tail] config apply (roles): applied 1, unchanged 11, db-owned 0, orphans: [old-station]
[lt-machines] lines: applied 2, unchanged 0, db-owned 0
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

## Display time zone

`display.timeZone` (an IANA name) renders every dashboard date in that zone, so a floor reads its own time on every screen: list columns, station facts, and detail pages alike. Unset, dates render in the viewer's browser zone. An unknown zone fails the boot.

```typescript
await start({
  // …
  display: { timeZone: 'America/Chicago' },
});
```

