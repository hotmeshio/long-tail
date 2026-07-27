# Personas API

A persona is a named bundle of roles with a per-role **relationship** scope — shorthand for adding a user to each linked role at the linked scope. Assignment fans out to ordinary role memberships (`lt_user_roles` stays the single source of authorization truth); the persona records why the memberships exist. Full semantics — provenance, highest-allowance union, overlay-on-reassign — are in [iam.md](../../iam.md#personas).

All endpoints require authentication plus role-management access (`admin` type, `superadmin`, or the `engineer` role) — the same audience that manages users and roles.

Relationship values map onto the member scope lattice:

| relationship | read_scope | write_scope |
|--------------|-----------|-------------|
| `write-all` | `all` | `all` |
| `write-self` | `all` | `self` |
| `read-all` | `all` | `none` |

`write-none` is accepted anywhere as a synonym for `read-all`.

## List personas

```
GET /api/personas
```

**Response 200:**

```json
{
  "personas": [
    {
      "id": "a1b2c3d4-...",
      "key": "production-manager",
      "title": "Production Manager",
      "description": "Runs the pipeline: works design and review, watches print and the fleet.",
      "roles": [
        { "role": "design", "relationship": "write-all" },
        { "role": "review", "relationship": "write-all" },
        { "role": "print", "relationship": "read-all" }
      ],
      "user_count": 2,
      "created_at": "2026-07-01T08:00:00.000Z",
      "updated_at": "2026-07-01T08:00:00.000Z"
    }
  ]
}
```

## Get a persona

```
GET /api/personas/:key
```

**Response 200:** the persona record plus `assignees` — `[{ id, external_id, display_name, email, assigned_at }]`. **404** when the key is unknown.

## Create a persona

```
POST /api/personas
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Required. Stable identifier, role-name alphabet (`^[a-z][a-z0-9_-]*$`) |
| `title` | `string` | Display title |
| `description` | `string` | The day-in-the-life, one paragraph |

**Response 201** with the created record. **409** when the key already exists.

## Update a persona

```
PATCH /api/personas/:key
```

PATCH semantics on `title` and `description` — omitted fields keep their values; `null` clears.

## Delete a persona

```
DELETE /api/personas/:key
```

Memberships the persona sustains are removed — or re-homed to a sibling persona the user still holds — before the persona row is deleted. Direct grants are never touched.

**Response 200:** `{ "deleted": true, "recompute": { "granted": 0, "refreshed": 0, "raised": 0, "removed": 3 } }`

## Link a role

```
PUT /api/personas/:key/roles/:role
```

**Body:** `{ "relationship": "write-all" }` — also updates an existing link's relationship. The role is created if absent, and every current holder's memberships are reconciled in the same transaction.

**Response 201:** `{ "role": "design", "relationship": "write-all", "recompute": { ... } }`

## Unlink a role

```
DELETE /api/personas/:key/roles/:role
```

Removes the link and reconciles every holder. **Response 200:** `{ "unlinked": true, "recompute": { ... } }`

## Seed personas (declarative)

```
POST /api/personas/seed
```

**Body:** `{ "personas": [{ "key", "title?", "description?", "roles": [{ "role", "relationship" }] }] }`

Idempotent and authoritative per spec: title/description are overlaid, role links are synced (links absent from the spec are pruned), linked roles are ensured as FK targets, and every current holder is reconciled. The SDK twin is `lt.personas.seed(specs)` — declare personas in the same seed pass that declares roles and `default_pins`.

**Response 200:** `{ "personas": 2, "links": 6, "recompute": { ... } }`

## Personas for a user

```
GET /api/users/:id/personas
```

**Response 200:**

```json
{
  "personas": [
    { "id": "a1b2c3d4-...", "key": "production-manager", "title": "Production Manager", "description": "...", "roles": [ ... ], "assigned_at": "2026-07-10T12:00:00.000Z" }
  ],
  "roles": [
    { "role": "design", "read_scope": "all", "write_scope": "all", "granted_by_persona": "production-manager" },
    { "role": "review", "read_scope": "all", "write_scope": "all", "granted_by_persona": null }
  ]
}
```

`roles` is the composed role/scope map: every membership with the persona sustaining it (`null` = direct grant).

## Assign a persona

```
POST /api/users/:id/personas
```

**Body:** `{ "persona": "production-manager" }`

Idempotent — re-assigning overlays fresh from the persona's current role links. Highest allowance wins across held personas; a direct grant's scope is only ever raised toward the union, never lowered.

**Response 200:** `{ "assigned": true, "recompute": { "granted": 3, "refreshed": 0, "raised": 1, "removed": 0 } }` — `granted` = memberships inserted, `refreshed` = persona-sustained rows overlaid, `raised` = direct rows lifted to the union, `removed` = sustained rows no held persona still grants.

## Unassign a persona

```
DELETE /api/users/:id/personas/:key
```

Removes only memberships the persona sustains; rows another held persona still grants are re-homed to it. Direct grants — including a membership added directly on top of a persona grant — are never touched.

**Response 200:** `{ "unassigned": true, "recompute": { ... } }`. **404** when the user does not hold the persona.
