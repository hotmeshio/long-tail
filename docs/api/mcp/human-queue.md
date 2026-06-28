# Human Queue

Built-in escalation and human queue management. Exposes the escalation API as MCP tools for AI agents and remediation workflows.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-human-queue` |
| Category | Automation |
| AI required | No |
| Credential providers | — |

## Compile Hints

escalate_and_wait creates a durable pause point. The step AFTER escalate_and_wait is always a signal step (kind: "signal") that receives the human response. Fields from the signal step output (e.g., password) must be wired via data_flow edges to ALL downstream steps that need them.

## Tools

### escalate_to_human

Create a new escalation for human review. Returns the escalation ID.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | Target role for the escalation (e.g., "reviewer") |
| message | string | Yes | Description of what needs human review |
| data | object | No | Contextual data for the reviewer |
| type | string | No | Escalation type classification (default: "mcp") |
| subtype | string | No | Escalation subtype (default: "tool_call") |
| priority | number | No | Priority: 1 (highest) to 4 (lowest) (default: 2) |

### check_resolution

Check the status of an escalation. Returns status and resolver payload if resolved.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| escalation_id | string | Yes | The escalation ID to check |

### get_available_work

List available escalations for a role. Returns pending, unassigned escalations.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | Role to filter by |
| limit | number | No | Max results to return (default: 10) |

### claim_and_resolve

Claim an escalation and immediately resolve it with a payload. Atomic operation. A read/write service account uses this to close out work and record the outcome in one call.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| escalation_id | string | Yes | The escalation ID to claim and resolve |
| resolver_id | string | Yes | Identifier for who/what is resolving |
| payload | object | Yes | Resolution payload data — resumes the waiting workflow |
| metadata | object | No | Outcome facets merged into the escalation's metadata: the durable, `@>`-queryable record of what happened (disposition, reviewer, timing). Distinct from `payload`, which is not indexed |

### resolve_escalation

Resolve an already-claimed escalation with a payload. Use when the claim happened externally (e.g. via API).

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| escalation_id | string | Yes | The escalation ID to resolve |
| payload | object | Yes | Resolution payload data — resumes the waiting workflow |
| metadata | object | No | Outcome facets merged into the escalation's metadata (see `claim_and_resolve`) |

### escalate_and_wait

Create an escalation and pause the workflow until a human responds. Returns a signal ID that the workflow uses to wait durably. Preferred over escalate_to_human + check_resolution polling.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | Target role for the escalation (e.g., "reviewer") |
| message | string | Yes | Description of what input is needed from the human |
| form_schema | object | No | JSON Schema for the resolver form. Use format:"password" for sensitive fields. |
| data | object | No | Contextual data for the reviewer |
| assigned_to | string | No | Auto-assign to a specific user |
| type | string | No | Escalation type classification (default: "mcp") |
| subtype | string | No | Escalation subtype (default: "wait_for_human") |
| priority | number | No | Priority: 1 (highest) to 4 (lowest) (default: 1) |

## Scope and One-Time Users

Escalations created by these tools land in the target role's queue. Each member of that role sees and acts on them according to their work-surface scope — two axes carried by the role membership alongside its `type` (`member`, `admin`, or `superadmin`):

- `read_scope` (`self` | `all`) governs which escalations a member sees. `read_all` shows the whole role queue; `read_self` shows only items assigned to the member (`assigned_to = user`).
- `write_scope` (`none` | `self` | `all`) governs which a member may claim and resolve. `write_self` acts only on the member's own assigned items; `write_all` acts on the whole queue. The constraint is write ⊆ read — you cannot act on what you cannot see.

An `admin` or `superadmin` member ignores scope and always acts on the whole queue. The defaults are `all`/`all` — the full-queue worker.

`get_available_work` lists pending, unassigned escalations for a role: the shared pool that whole-queue (`write_all`) workers pull from. A `write_self` member does not draw from this pool — their item is pre-assigned to them.

### The one-time-user pattern

To route a single escalation to a named person, set `assigned_to` when creating it — the `assigned_to` field on `escalate_and_wait` pre-claims the item for that user — and provision that person as a `member` of the role with `read_self` + `write_self`. The result is a scoped single-item surface: they see and act on exactly that one escalation, with no access to the rest of the queue. The scoped membership is provisioned through the platform's user and escalation APIs (see the [Roles API](../http/roles.md)); these MCP tools supply the `assigned_to` pre-claim.
