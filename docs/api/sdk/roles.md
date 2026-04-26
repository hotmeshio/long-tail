# lt.roles

Manage roles and escalation chain routing between roles.

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
