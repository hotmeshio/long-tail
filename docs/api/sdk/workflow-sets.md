# lt.workflowSets

Manage compositional workflow sets: plan, build, and deploy groups of related workflows.

## create

Create a new workflow set and kick off the LLM-powered planner.

```typescript
const result = await lt.workflowSets.create({
  name: 'onboarding-pipeline',
  specification: 'A multi-step onboarding pipeline that verifies email, provisions accounts, and sends a welcome message',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique name for the workflow set |
| `description` | `string` | No | Description of the workflow set |
| `specification` | `string` | Yes | Free-text specification the planner uses to generate workflows |

**Returns:** `LTApiResult<{ ...WorkflowSet, source_workflow_id: string, planner_workflow_id: string }>`

**Auth:** Optional (userId forwarded to the planner when provided)

---

## list

List workflow sets with optional filtering and pagination.

```typescript
const result = await lt.workflowSets.list({ status: 'planned', limit: 10 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | No | Filter by workflow set status |
| `search` | `string` | No | Free-text search across set names or descriptions |
| `limit` | `number` | No | Maximum number of results to return |
| `offset` | `number` | No | Pagination offset |

**Returns:** `LTApiResult<WorkflowSet[]>`

**Auth:** Not required

---

## get

Retrieve a single workflow set by ID.

```typescript
const result = await lt.workflowSets.get({ id: 'set-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the workflow set |

**Returns:** `LTApiResult<WorkflowSet>`

**Auth:** Not required

---

## updatePlan

Replace the plan and optional namespaces on a workflow set.

```typescript
const result = await lt.workflowSets.updatePlan({
  id: 'set-id',
  plan: [{ name: 'step1', description: 'Verify email' }],
  namespaces: [{ name: 'onboarding', description: 'Onboarding namespace' }],
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the workflow set to update |
| `plan` | `any[]` | Yes | Array of plan entries |
| `namespaces` | `any[]` | No | Array of namespace definitions associated with the plan |

**Returns:** `LTApiResult<WorkflowSet>`

**Auth:** Not required

---

## build

Transition a workflow set from "planned" to "building" status.

```typescript
const result = await lt.workflowSets.build({ id: 'set-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the workflow set to build |

**Returns:** `LTApiResult<{ status: 'building', id: string }>`

**Auth:** Not required

---

## deploy

Transition a workflow set to "deploying" status.

```typescript
const result = await lt.workflowSets.deploy({ id: 'set-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the workflow set to deploy |

**Returns:** `LTApiResult<{ status: 'deploying', id: string }>`

**Auth:** Not required
