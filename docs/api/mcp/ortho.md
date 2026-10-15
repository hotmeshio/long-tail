# Ortho (example server)

Example connector for the `ortho-pipeline` example workflow (`examples/workflows/ortho-pipeline`). `system/index.ts` registers it when the `examples/` tree is available; the npm package excludes it.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-ortho` |
| Category | Automation |
| AI required | No |
| Source | `examples/mcp-servers/ortho.ts` |
| Tool manifest | `examples/seed/tool-manifests-ortho.ts` |

## Overview

AI-operable tools for driving the orthotic manufacturing pipeline. Each order passes through eight sequential stages (design → review → print → grind → glue → finish → qa → ship). The pipeline is a HotMesh durable workflow; each stage suspends at a `conditional` checkpoint until an escalation is resolved.

A Claude agent loop calls `ortho_submit` to start an order, polls `ortho_pending` to see what's waiting, drives each stage forward with `ortho_complete_stage`, and monitors progress with `ortho_status`.

### ortho_submit

Start a new orthotic manufacturing order through the 8-stage pipeline.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | `string` | Yes | Unique order identifier (e.g. `"ORD-001"`) |
| `item_type` | `string` | Yes | Item type (e.g. `"insole-standard"`, `"insole-diabetic"`) |
| `stages` | `string[]` | No | Override the stage sequence. Default: `["design","review","print","grind","glue","finish","qa","ship"]` |
| `metadata` | `object` | No | Additional order metadata passed through to each stage escalation |

**Returns:** `{ workflow_id, order_id, item_type, stages, message }`

---

### ortho_pending

List open ortho-pipeline stage escalations waiting to be completed.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stage` | `string` | No | Filter to a specific stage (e.g. `"design"`). Omit to see all stages |
| `limit` | `integer` | No | Max results (default: 50) |

**Returns:** `{ count, escalations }` where each escalation includes `id`, `stage`, `order_id`, `item_type`, `description`, `created_at`, `workflow_id`.

---

### ortho_complete_stage

Complete a pending ortho pipeline stage. Claims the escalation and resolves it with notes and outcome data. Resolving automatically advances the workflow — a new escalation for the next stage appears within seconds.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `escalation_id` | `string` | Yes | Escalation ID from `ortho_pending` |
| `notes` | `string` | Yes | Completion notes — what was done, any decisions made |
| `outcome` | `object` | No | Structured outcome data specific to this stage |

**Returns:** `{ resolved, escalation_id, status, message }`

---

### ortho_status

Get the current status and completed stage results for an ortho pipeline workflow.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow_id` | `string` | Yes | Workflow ID from `ortho_submit` |

**Returns:** `{ workflow_id, status }` where `status` is `"running"` while in progress or `"complete"` with `result` containing all stage outputs once finished.

---

**Agent loop example:**

```
ortho_submit({ order_id: "ORD-042", item_type: "insole-diabetic" })
→ { workflow_id: "wf-abc123", stages: ["design", "review", ...] }

ortho_pending({ stage: "design" })
→ [{ id: "esc-001", stage: "design", order_id: "ORD-042" }]

ortho_complete_stage({ escalation_id: "esc-001", notes: "3mm heel, D-width approved", outcome: { spec_version: "v2" } })
→ { resolved: true }

... repeat through all 8 stages ...

ortho_status({ workflow_id: "wf-abc123" })
→ { status: "complete", result: { order_id: "ORD-042", results: [...] } }
```
