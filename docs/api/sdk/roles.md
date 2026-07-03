# lt.roles

Manage roles and escalation chain routing between roles.

## Work-Surface Scope

A role is a task queue worked by its members. Each `member` assignment carries two work-surface scope axes that set how much of the queue that member touches:

- `read_scope` (`self` or `all`, default `all`) governs **search** — which escalations the member sees.
- `write_scope` (`none`, `self`, or `all`, default `all`) governs **claim / ack (resolve) / delete (cancel)** — which escalations the member may act on.

`self` means items assigned to the member; `all` means the whole role queue. The constraint is **write ⊆ read** — `write_scope=all` requires `read_scope=all`. `admin` and `superadmin` ignore scope and always act on the whole queue. The default `all`/`all` is the full-queue worker.

Scope is set when a role is assigned to a user, via [`lt.users.addRole`](users.md) and [`lt.users.create`](users.md). See [Roles API — Work-Surface Scope](../http/roles.md) for the five member profiles.

## RoleDetail type

`listWithDetails` and `update` return `RoleDetail` objects:

```typescript
interface RoleDetail {
  role: string;
  title: string | null;
  description: string | null;
  form_schema: Record<string, any> | null;
  metadata_schema: Record<string, any> | null;
  properties: Record<string, any>;
  ops_visible: boolean;
  parent_role: string | null;
  sla_minutes: number | null;
  target_per_hour: number | null;
  worker_count: number | null;
  user_count: number;
  chain_count: number;
  workflow_count: number;
}
```

| Field | Description |
|-------|-------------|
| `role` | Unique role key |
| `title` | Display name shown in the dashboard |
| `description` | Short description of the role's purpose |
| `form_schema` | Default JSON Schema for the resolve form; overridden per-escalation by `metadata.form_schema` |
| `metadata_schema` | JSON Schema for `lt_escalations.metadata`; used for validation and UI hints |
| `properties` | Free user-owned bag — arbitrary config stored on the role |
| `ops_visible` | When `true`, the role appears as a station on the Operations view |
| `parent_role` | Parent role in the process dependency graph; drives the pace chart dependency ordering |
| `sla_minutes` | SLA target in minutes — items older than this appear in `in_arrears` in station metrics |
| `target_per_hour` | Throughput target used to compute `throughput_pct` in station metrics |
| `worker_count` | Station capacity — number of workers expected to be active |
| `user_count` | Number of users currently assigned to this role |
| `chain_count` | Number of escalation chain links originating from this role |
| `workflow_count` | Number of registered workflows that target this role |

The three capacity fields (`sla_minutes`, `target_per_hour`, `worker_count`) power the Operations station detail panel. `ops_visible` controls which roles appear on the `/operations` view. `parent_role` enables the process dependency graph in the pace chart — set it to describe which upstream role feeds this one.

---

## list

List all distinct role names in the system.

```typescript
const result = await lt.roles.list();
```

**Parameters:** None (pass `{}` or `undefined`).

**Returns:** `LTApiResult<{ roles: string[] }>`

**Auth:** Not required

---

## listWithDetails

List all roles with full details (member counts, escalation chains, etc.).

```typescript
const result = await lt.roles.listWithDetails();
```

**Parameters:** None (pass `{}` or `undefined`).

**Returns:** `LTApiResult<{ roles: RoleDetail[] }>`

**Auth:** Not required

---

## create

Create a new role.

The role name is trimmed, lowercased, and validated against `^[a-z][a-z0-9_-]*$`.

```typescript
const result = await lt.roles.create({ role: 'senior-reviewer' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Role name (lowercase letters, numbers, hyphens, underscores; must start with a letter) |

**Returns:** `LTApiResult<{ role: string }>` (status 201)

**Auth:** Not required

---

## delete

Delete a role from the system.

```typescript
const result = await lt.roles.delete({ role: 'old-role' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Role name to delete |

**Returns:** `LTApiResult<{ deleted: true }>` -- returns 409 if the role cannot be deleted (e.g., still assigned to users).

**Auth:** Not required

---

## getEscalationChains

Retrieve all escalation chains across all roles.

```typescript
const result = await lt.roles.getEscalationChains();
```

**Parameters:** None (pass `{}` or `undefined`).

**Returns:** `LTApiResult<{ chains: EscalationChain[] }>`

**Auth:** Not required

---

## addEscalationChain

Add an escalation chain link from one role to another.

```typescript
const result = await lt.roles.addEscalationChain({
  source_role: 'reviewer',
  target_role: 'senior-reviewer',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_role` | `string` | Yes | Role that escalates from |
| `target_role` | `string` | Yes | Role that receives the escalation |

**Returns:** `LTApiResult<{ source_role, target_role }>` (status 201)

**Auth:** Not required

---

## removeEscalationChain

Remove an escalation chain link between two roles.

```typescript
const result = await lt.roles.removeEscalationChain({
  source_role: 'reviewer',
  target_role: 'senior-reviewer',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_role` | `string` | Yes | Role that escalates from |
| `target_role` | `string` | Yes | Role that receives the escalation |

**Returns:** `LTApiResult<{ removed: true }>` -- returns 404 if not found.

**Auth:** Not required

---

## getEscalationTargets

Get all escalation target roles for a given source role.

```typescript
const result = await lt.roles.getEscalationTargets({ role: 'reviewer' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Source role to look up targets for |

**Returns:** `LTApiResult<{ targets: string[] }>`

**Auth:** Not required

---

## replaceEscalationTargets

Replace all escalation targets for a role with a new set.

```typescript
const result = await lt.roles.replaceEscalationTargets({
  role: 'reviewer',
  targets: ['senior-reviewer', 'team-lead'],
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Source role whose targets are being replaced |
| `targets` | `string[]` | Yes | Array of target role names |

**Returns:** `LTApiResult<{ role, targets }>`

**Auth:** Not required

---

## update

Update a role's metadata. Only provided fields are changed; omitted fields remain unchanged. `form_schema`, `metadata_schema`, and `parent_role` can be set to `null` to clear them.

```typescript
const result = await lt.roles.update({
  role: 'reviewer',
  title: 'Document Reviewer',
  ops_visible: true,
  sla_minutes: 30,
  target_per_hour: 20,
  worker_count: 4,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Role key to update |
| `title` | `string \| null` | No | Display name |
| `description` | `string \| null` | No | Short description |
| `form_schema` | `object \| null` | No | JSON Schema for the resolve form |
| `metadata_schema` | `object \| null` | No | JSON Schema for `lt_escalations.metadata` |
| `properties` | `object \| null` | No | Free user-owned bag |
| `ops_visible` | `boolean` | No | Show as a station on the Operations view |
| `parent_role` | `string \| null` | No | Parent role in the process dependency graph |
| `sla_minutes` | `number \| null` | No | SLA target in minutes |
| `target_per_hour` | `number \| null` | No | Throughput target (items per hour) |
| `worker_count` | `number \| null` | No | Station capacity |
| `change_summary` | `string` | No | Label recorded on the schema version snapshot when this update changes a schema field |

When the update changes `form_schema` or `metadata_schema`, the new pair is snapshotted into the role's version history and `current_schema_version` advances.

**Returns:** `LTApiResult<RoleDetail>` — the updated role.

**Auth:** Role manager (admin type, superadmin, or engineer)

## getSchema

Fetch a role's `form_schema` + `metadata_schema` pair. With `version`, reads that immutable snapshot from the version history (the one an escalation pins via `conditionLT`'s `schemaVersion`); without it, reads the live (latest) schema and its current version number. A missing version is a 404 — it never falls back to a different version.

```typescript
const latest = await lt.roles.getSchema({ role: 'reviewer' });
const pinned = await lt.roles.getSchema({ role: 'reviewer', version: 3 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Role whose schema to fetch |
| `version` | `number` | No | Version pin (positive integer) |

**Returns:** `LTApiResult<RoleSchemaVersion>` — `{ role, version, form_schema, metadata_schema, change_summary, created_at, latest_version }`.

## listSchemaVersions

List a role's schema version history, newest first. Each entry carries the version number, presence flags for the two schemas, the change summary, and whether it is the role's current version.

```typescript
const result = await lt.roles.listSchemaVersions({ role: 'reviewer' });
// result.data.versions → [{ version, has_form_schema, has_metadata_schema, change_summary, created_at, is_current }, …]
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | Yes | Role whose history to list |

**Returns:** `LTApiResult<{ versions: RoleSchemaVersionSummary[] }>`
