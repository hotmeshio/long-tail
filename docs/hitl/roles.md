# Role Routing and RBAC

## Role-Based Routing

Escalations are routed by role, and any member of the role can handle them — a person working the queue in the dashboard, or a service account claiming and resolving through the API or MCP tools. Members only see escalations for roles they hold. Set `role` on every `conditionLT` config to name the target queue:

```typescript
const decision = await conditionLT<{ approved: boolean }>(signalId, {
  role: 'finance-reviewer',   // only users with this role see it
  description: `Approve spend of $${amount}`,
  // ...
});
```

---

## Work-Surface Scope

A `member` of a role carries a work-surface scope that narrows what they see and act on within that queue:

| Scope field | Values | Meaning |
|-------------|--------|---------|
| `read_scope` | `self` / `all` | Which escalations the member sees |
| `write_scope` | `none` / `self` / `all` | Which escalations the member can claim, resolve, or cancel |

`self` means escalations assigned to that member (`assigned_to = user`); `all` means the whole role queue. `admin` and `superadmin` always work the whole queue.

Scope is a property of the **membership** (`lt_user_roles`), not of the escalation row. The escalation engine is unchanged — `conditionLT` and `ltCreateEscalation` write rows exactly as before. Scope is resolved at read time when a user lists or acts on the queue.

See the [Roles API](../api/http/roles.md#work-surface-scope) for the five member profiles and the assignment contract.

---

## One-Time and Pre-Assigned Escalations

To route a single item to a named person, assign the escalation to them and provision them with `read_scope=self` + `write_scope=self`. The workflow sets `assigned_to` to the person's user ID when it creates the escalation, then provisions or updates that user as a `member` with self/self scope on the target role. They land directly on that one item — a just-in-time form scoped by RBAC — with no access to the rest of the queue.

```typescript
const decision = await conditionLT<{ confirmed: boolean; address: string }>(signalId, {
  role: 'customer-triage',
  assigned_to: userId,     // pre-claim
  description: 'Confirm your shipping address',
  metadata: {
    form_schema: {
      title: 'Confirm Address',
      properties: {
        address:   { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['confirmed'],
    },
  },
});
```

---

## Escalation Chains

Users can escalate to other roles via the "Escalate" tab on the detail page. Configure chain targets in Admin > Roles. Each role lists which other roles it can escalate to. Common shape:

```
Analyst → Senior Analyst → Manager → VP
```

Chains are runtime RBAC — they control who can receive an escalation handed off from this role. `parent_role` and `ops_visible` are the process graph Operations renders.

---

## Schema Versioning

See [escalation.md](escalation.md#versioned-role-schemas) for the full versioning contract — how to pin a schema version on an escalation row, how to inspect versions, and how to save a new version.
