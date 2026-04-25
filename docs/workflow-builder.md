# The Workflow Builder: From Prompt to Plan

## The Gap Between a Prompt and a System

The current workflow builder takes a prompt and produces a single DAG. Describe a task, the LLM constructs YAML, you deploy a tool. This works when the unit of work is one workflow — screenshot a page, check a patient's coverage, submit a form.

But the engineering team sitting with Linda doesn't have one task. They have a PRD. A technical design document. Pages of specifications describing a referral intake system with branching paths, composed sub-processes, human review gates, and payer-specific variations. The system they need isn't one workflow. It's a set of interrelated workflows — some calling others, some waiting for human input, some branching based on data conditions — that together implement a complete operational process.

Today, the engineer would decompose the PRD manually, build each workflow individually through the wizard, deploy them into the same namespace, and wire the composition by hand. That works, but it's the same translation problem the builder was designed to eliminate: the engineer becomes the bottleneck between the specification and the executable system.

The evolution is plan mode. When the input exceeds what a single workflow can express — because it's long, because it describes composition, because it references multiple processes — the builder enters a planning phase. It decomposes the specification into workflows, identifies their relationships, builds them leaf-first, and deploys them as a coordinated set.

---

## Two Entry Points, Same Destination

The builder already has two modes:

**Discover & Compile.** Run a dynamic execution with AI, then compile the trace into a deterministic DAG. The execution is the specification — the compiler extracts the pattern from what actually happened.

**Direct Build.** Describe the workflow, and the LLM constructs the YAML directly from tool schemas without executing anything. The engineer's description is the specification.

Plan mode extends Direct Build. The input is the same textarea. The difference is what the input contains. A short prompt ("check referral coverage for a patient") produces a single workflow. A long specification with composition, branching, and multiple processes triggers plan mode.

The detection is straightforward: length beyond a threshold, or structural signals in the content — references to multiple steps that are themselves processes, explicit composition language ("this flow calls that flow"), mentions of planning or phased execution. When plan mode activates, the builder wraps the existing single-workflow wizard in an outer loop that plans first, then builds each workflow through the same pipeline.

---

## What Plan Mode Produces

A plan is a decomposition of the specification into workflows with defined relationships:

**Leaf workflows** have no dependencies on other custom workflows. They call MCP tools directly — FHIR queries, browser actions, file operations. They're the atomic units of the system.

**Composition workflows** call leaf workflows (or other composition workflows) as activities. They encode sequencing, branching, and human-in-the-loop gates. They're the orchestration layer.

**The build order is leaf-first.** The planner identifies terminal workflows — the ones that don't invoke other custom workflows — and builds those first. Then it builds the workflows that compose them. Then the workflows that compose those. The tree builds from the leaves up, because each layer needs to reference the tools that already exist in the layer below.

Each workflow in the plan belongs to a namespace. Workflows in the same namespace are deployed together as one HotMesh application. They can invoke each other using HotMesh's `await` activity — a direct, typed call within the same execution engine. This is the tightest composition: same deployment, same transaction boundary, same namespace.

Workflows in different namespaces invoke each other as MCP tools. The calling workflow treats the target as any other tool — discovered by tag, invoked through the MCP protocol, results returned as structured data. This is the loosest composition: independent deployment, independent versioning, connected only through the tool interface.

The planner decides which workflows belong together based on coupling. Workflows that share data context, that are always deployed together, that represent phases of the same process — same namespace. Workflows that represent independent capabilities, that might be reused across processes, that have different versioning cycles — separate namespaces.

---

## The Outer Loop

The existing wizard has four steps in builder mode: Describe, Profile, Deploy, Test. Plan mode wraps this in an outer loop:

**Plan step.** The specification goes in. The planner produces a structured decomposition: which workflows to build, in what order, with what relationships. The dashboard displays this as a list or graph — the set of workflows, their dependencies, their namespaces. The engineer reviews, adjusts, and confirms.

**Build loop.** For each workflow in the plan (leaf-first), the system runs the existing builder pipeline: construct YAML from the specification slice, validate, present for review. The engineer sees the familiar Profile → Deploy → Test sequence for each workflow, but the context is richer — the plan shows where this workflow fits in the larger system, which workflows call it, which it calls.

**Verification.** After all workflows are built and deployed, the system runs the composition end-to-end. The engineer provides inputs at the top level, and the execution cascades through the composed workflows. Escalation points pause and wait. Branch conditions route correctly. The full system operates as specified.

The UX for the outer loop is familiar. The plan step is a new panel above the wizard — a progress view showing which workflows have been built, which are next, which are pending. When the engineer clicks into a specific workflow, they see the standard wizard steps. When they step back out, they see the plan.

Real-time updates flow through the existing event system. As each workflow compiles, deploys, and activates, the plan view updates. Build progress, deployment status, test results — all surfaced through the same SSE/NATS topic subscriptions the wizard already uses.

Plan view has both expanded, collapsed modes. These serve to infrorm what is going on at a global level, but also can be collapsed sufficiently to provide high-level progress while allowing the engineer to focus on the target workflow currently loaded in the wizard.

---

## Workflow Sets: The Data Model

The current `lt_yaml_workflows` table stores individual workflows. Plan mode produces sets of related workflows. The relationship between them — which calls which, which namespace they share, which plan produced them — needs a home.

A new entity: **workflow set**. A set is a named group of workflows produced by a single plan. It records:

- The original specification (the PRD, the TDD, the markdown that was pasted in)
- The plan (the decomposition into workflows with relationships)
- The namespaces involved
- The build order
- The status of each workflow in the set (planned, building, deployed, active, failed)

Each `lt_yaml_workflows` record gains an optional `set_id` foreign key. Workflows not produced by a plan have no set. Workflows produced by a plan reference their set, and through it, their siblings and their relationships.

The set is a first-class entity in the dashboard. An engineer can view all workflows in a set, see their dependency graph, deploy or redeploy the set, and trace execution through composed workflows. When a leaf workflow is updated (because Epic changed an API, because a payer changed rules), the set view shows which composition workflows are affected.

This also solves the grouping problem for workflows that aren't plan-produced. An engineer who builds three related workflows individually can group them into a set after the fact. The set is an organizational unit, not just a plan artifact.

---

## Composition Mechanics

### Same-Namespace Composition

Workflows in the same namespace are deployed as a single HotMesh application. They share a deployment lifecycle — when any workflow in the namespace is updated, the entire namespace redeploys (merging all YAML graphs).

Within the same namespace, a workflow invokes another using a worker activity whose `workflowName` matches the target's `subscribes` topic. The call is synchronous from the caller's perspective — the activity blocks until the child workflow completes — but durable underneath. If the worker process crashes, the child workflow's progress is preserved, and execution resumes from the last checkpoint.

Data flows through typed input/output schemas. The caller maps its data to the child's input schema. The child's output maps back to the caller's next activity. The YAML wiring is explicit — every field is traced.

### Cross-Namespace Composition

Workflows in different namespaces are independent MCP tools. The calling workflow invokes them through the standard MCP tool protocol — the same mechanism used for browser automation, FHIR queries, or any other tool.

This is composition through the tool layer. The caller doesn't know or care whether the target is a compiled workflow, a built-in MCP server, or an external service. It discovers the tool by tag, passes arguments, and receives results. The target workflow runs in its own namespace, with its own deployment lifecycle, its own versioning.

Cross-namespace composition is the right choice when:

- The target workflow is reusable across processes (a coverage check used by both intake and scheduling)
- The target has a different release cadence (payer-specific tools updated independently)
- The target belongs to a different team or domain

### The Composition Spectrum

Same-namespace `await` and cross-namespace MCP tool calls are two points on a spectrum. The planner chooses based on coupling signals in the specification. Tightly coupled processes that share data context and deploy together go in the same namespace. Independent capabilities that serve multiple consumers go in separate namespaces.

An engineer can override the planner's choice. Move a workflow from one namespace to another, and the composition mechanism changes automatically — `await` becomes an MCP tool call, or vice versa. The workflow's logic doesn't change. Only the wiring.

---

## The Prompt Strategy

The builder's LLM prompt is the critical path. It teaches the model how to construct valid HotMesh YAML — activity definitions, transitions, `@pipe` data flow, signal hooks, iteration patterns, collision-proofing suffixes. The existing prompt handles single workflows well.

Plan mode extends the prompt in two dimensions:

**Decomposition.** The planner prompt takes the full specification and produces a structured plan: workflow names, descriptions, input/output contracts, dependencies, namespace assignments, build order. This is a different LLM task than YAML construction — it's architectural reasoning about how to decompose a system into workflows.

**Cross-references.** When the builder constructs a composition workflow, it needs to know the input/output schemas of the workflows it calls. The prompt includes these schemas as context — "workflow `check-coverage` accepts `{patient_id, referral_id}` and returns `{covered, prior_auth_required, plan_code}`." The builder wires the composition using these contracts.

The prompt strategy for complex specifications is iterative. The planner makes a first pass. The engineer reviews. Adjustments feed back into the planner. Each workflow in the plan is built with the full plan as context — the builder knows where each piece fits. This is why plan mode is a loop, not a single shot.

For very large specifications — a full PRD with edge cases, error handling, and operational requirements — the planner may produce nested plans. A top-level plan decomposes into sub-systems. Each sub-system has its own namespace and its own set of workflows. The sub-systems compose through MCP tool calls. This is a plan that produces plans — the outer loop runs recursively.

---

## Human-in-the-Loop in Compiled Workflows

The existing system ships a human-queue MCP server with tools for durable pause points: `escalate_to_human`, `check_resolution`, `escalate_and_wait`. Compiled YAML workflows use these as regular activities.

In the YAML, a human-in-the-loop step is two activities:

1. A **worker** activity that calls `escalate_to_human` (or `escalate_and_wait`) with the escalation payload — what needs review, what context to show, what role should handle it.
2. A **hook** activity that pauses the workflow and waits for a signal. The signal carries the human's response — approved/rejected, corrected data, additional instructions.

The hook's `signal_schema` defines what the human provides. The dashboard renders a form from this schema. When the human submits, the signal fires, the hook receives the data, and the workflow resumes.

Plan mode makes this explicit in the decomposition. When the specification says "a coordinator reviews the referral before scheduling," the planner creates a workflow with an escalation step between the validation activities and the scheduling activities. The escalation's role, payload, and expected response are derived from the specification.

Conditional transitions after the hook encode the branching: if approved, proceed to scheduling; if rejected, escalate to the referring provider; if corrected, re-run validation with the corrected data. These branches are deterministic — the YAML encodes every path. The human's choice selects the path. No LLM involved.

---

## What the Engineer Sees

### Pasting the PRD

The engineer opens the Pipeline Designer in builder mode. The textarea is the same one that accepts a short prompt. This time, the engineer pastes three pages of markdown — a referral intake specification with sections for validation, coverage checking, document requirements, payer-specific rules, escalation chains, and scheduling handoff.

The system detects the input's complexity and activates plan mode. The UI transitions: above the wizard steps, a new panel appears showing the plan as it forms.

### The Plan View

The planner produces a decomposition. The dashboard renders it as a dependency graph:

```
referral-intake (namespace: referral-ops)
├── validate-referral (leaf)
├── check-coverage (leaf, payer-branching)
├── verify-documents (leaf, referral-type-specific)
├── resolve-gaps (composition: escalate → wait → retry)
├── route-to-scheduling (leaf)
└── process-referral (composition: orchestrates all above)
```

Each node shows: name, type (leaf/composition), namespace, status (planned/building/deployed). The engineer can click into any node to see the planned input/output schema and which tools it will use.

The engineer reviews. "The coverage check should be in its own namespace — we reuse it for eligibility verification in another process." They drag the node to a new namespace. The plan adjusts: the composition workflow that called it now references it as an MCP tool instead of an `await` activity.

### Building Leaf-First

The engineer confirms the plan. The system begins building, starting with leaf workflows. The plan view updates in real time — each node's status changes from "planned" to "building" to "deployed" as the builder completes each workflow.

For each workflow, the engineer can expand into the standard wizard: review the YAML, adjust the profile, deploy, test with sample inputs. Or they can let the builder proceed automatically and review the full set at the end.

### Testing the Composition

After all workflows deploy, the engineer runs the top-level `process-referral` workflow with a test referral. The execution cascades: validation calls the validate-referral tool, coverage check invokes the check-coverage MCP tool (cross-namespace), document verification runs in-namespace. At the escalation step, the workflow pauses. The engineer resolves it through the dashboard. The workflow resumes and completes.

The plan view shows the execution trace across all workflows — a unified timeline of which tools ran in which workflow, with durations and data flow visible.

---

## The Epic Story, Continued

The engineering team building referral intake for back-office customers doesn't paste one prompt at a time. They have specifications. They've sat with Linda and Maria and James, captured the full intake process, and written it up as a PRD with sections, edge cases, and decision tables.

They paste the PRD into the builder. Plan mode activates. The planner decomposes it:

- **Namespace `referral-intake`**: `validate-referral`, `verify-documents`, `resolve-gaps`, `route-to-scheduling`, `process-referral` (composition)
- **Namespace `payer-tools`**: `check-coverage-bluecross`, `check-coverage-aetna`, `check-coverage-default`, `check-coverage` (router composition)
- **Namespace `epic-fhir`**: Low-level FHIR operations if not already registered as MCP tools

The payer-specific coverage tools are in their own namespace because they version independently — when Aetna changes rules, only `check-coverage-aetna` updates. The intake workflows reference them as MCP tools.

The engineer reviews the plan, adjusts namespace assignments, confirms. The builder produces the full set of workflows. The engineer tests the composition end-to-end against Epic's sandbox. Linda's knowledge, Maria's knowledge, James's knowledge — encoded in a coordinated set of deterministic tools that run without AI, without the domain experts, against any customer's Epic instance.

When the PRD changes — and it will — the engineer pastes the updated section. Plan mode produces a delta: which workflows need rebuilding, which are unchanged, which have new dependencies. The system evolves incrementally, the same way the specification evolved.

---

## Implementation Surface

### Data Model

**New table: `lt_workflow_sets`**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `name` | TEXT | Human-readable set name |
| `description` | TEXT | Set description |
| `specification` | TEXT | Original input (PRD, TDD, markdown) |
| `plan` | JSONB | Decomposition: workflows, relationships, namespaces, build order |
| `namespaces` | TEXT[] | App IDs involved |
| `status` | TEXT | `planning` / `building` / `deployed` / `active` / `failed` |
| `source_workflow_id` | TEXT | Builder workflow that produced the plan |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Addition to `lt_yaml_workflows`:**

| Column | Type | Purpose |
|--------|------|---------|
| `set_id` | UUID (nullable, FK) | References `lt_workflow_sets.id` |
| `set_role` | TEXT (nullable) | `leaf` / `composition` / `router` |
| `set_build_order` | INTEGER (nullable) | Build sequence within the set |

### API Endpoints

**Plan lifecycle:**
- `POST /api/workflow-sets` — create set from specification, triggers planning
- `GET /api/workflow-sets` — list sets with status filters
- `GET /api/workflow-sets/:id` — get set with plan and workflow statuses
- `PUT /api/workflow-sets/:id/plan` — update plan (engineer adjustments)
- `POST /api/workflow-sets/:id/build` — start building (leaf-first)
- `POST /api/workflow-sets/:id/deploy` — deploy all namespaces
- `GET /api/workflow-sets/:id/workflows` — list workflows in set with relationships

**Extended workflow endpoints:**
- `GET /api/yaml-workflows?set_id=:id` — filter by set membership

### Workflow: `mcpWorkflowPlanner`

A new system workflow that decomposes specifications into plans. Activities:

- `analyzeSpecification` — detect complexity, extract structural signals
- `decomposeIntoWorkflows` — LLM-driven decomposition with namespace assignment
- `validatePlan` — check for circular dependencies, missing contracts, namespace conflicts
- `refinePlan` — incorporate engineer feedback

The planner workflow produces the plan. The existing `mcpWorkflowBuilder` workflow builds each individual workflow in the plan. The orchestration between planner and builder is itself a composition — the planner calls the builder for each workflow in the plan, leaf-first.

### Dashboard Components

**PlanView** — the outer loop panel showing the workflow dependency graph, build status, and namespace groupings. Wraps the existing wizard steps.

**PlanNode** — individual workflow in the plan view. Shows name, type, namespace, status, and links to the standard wizard for that workflow.

**SetListPage** — list of workflow sets, filterable by status and namespace. Entry point for managing multi-workflow systems.

### Events

Plan mode publishes events on the existing NATS topic space:

- `lt.plan.created` — plan produced from specification
- `lt.plan.workflow.building` — individual workflow build started
- `lt.plan.workflow.deployed` — individual workflow deployed
- `lt.plan.completed` — all workflows in plan built and deployed
- `lt.plan.failed` — build failure with context

The dashboard subscribes to these for real-time plan view updates.

---

## Prompt Strategy: Teaching the LLM to Build YAML

### What Exists

The current builder prompt (`prompts.ts`) teaches four activity types — trigger, worker, hook, cycle — with strong coverage of `@pipe` RPN semantics and collision-proofing rules. The RPN section ("operands THEN operator") is particularly effective; LLMs reliably produce correct pipe expressions when the stack-machine framing is clear.

The prompt includes an abbreviated operator list: the most-used methods from `@string`, `@date`, `@math`, `@number`, `@array`, `@object`, `@conditional`, and `@json`. This is sufficient for single workflows that transform strings, build paths, and iterate arrays.

### What's Missing

Three activity types are absent from the prompt: **await**, **signal**, and **interrupt**. These are precisely the types needed for composition and cross-workflow communication — the core of plan mode.

The operator catalog is abbreviated. The full HotMesh pipe system exposes 13 handler categories with over 150 methods. Most are rarely needed, but gaps in the catalog produce workarounds: the LLM constructs multi-step pipes to accomplish what a single operator would do, or worse, hardcodes values that should be computed.

Conditional transitions — the mechanism for branching based on activity output — are not documented in the prompt. The LLM can produce linear flows but struggles with branches, error routing, and cycle exit conditions.

### The Reference System

Rather than inflating the prompt with everything, the builder uses a modular reference system. Reference files live alongside the prompt at `system/workflows/mcp-workflow-builder/reference/`:

**`activity-types.md`** — Complete documentation of all 8 activity types with YAML examples, properties, and usage guidance. Covers trigger, worker, hook (all 4 modes), cycle, await (sync and fire-and-forget), signal (one and all), and interrupt (self and remote).

**`pipe-functions.md`** — Full catalog of every `@pipe` operator across all 13 handler categories with signatures and return types.

### Injection Strategy

The prompt is assembled from layers. The base prompt always includes:

- Trigger, worker, hook, cycle — the types every workflow needs
- `@pipe` RPN rules with the "common mistake" examples
- Core operators: `@string` (concat, substring, toLowerCase), `@date` (now, yyyymmdd, toISOString), `@math` (add), `@array` (get, length), `@object` (get)
- Construction rules (collision-proofing, _scope threading, workflowName, job.maps)
- Clarification protocol

Additional context is injected based on what the specification requires:

**Composition detected** (specification references child workflows, sub-processes, or the plan contains multiple workflows) → inject the **await** activity reference. This teaches the LLM how to invoke child workflows within the same namespace, how to wire input/output contracts, and how to use fire-and-forget mode.

**HITL detected** (specification mentions human review, approval gates, escalation) → inject the **signal** activity reference and the full **hook** web-hook mode documentation. This teaches signal routing through the `hooks:` section, `code: 200` vs `code: 202`, and the escalation-then-wait pattern.

**Cancellation detected** (specification mentions timeout, abort, cancel) → inject the **interrupt** activity reference. Self-interrupt for validation failures, remote interrupt for cancelling child workflows.

**Branching detected** (specification mentions conditional paths, error handling, routing) → inject **conditional transitions** documentation with examples of `conditions.code`, `conditions.match`, and multi-target transition arrays.

**Complex transforms detected** (specification involves date arithmetic, array manipulation, object construction beyond simple field references) → inject the extended **pipe function catalog** for the relevant categories.

### Why Not Include Everything

Prompt length directly affects YAML quality. The current prompt is approximately 270 lines — tight enough that the LLM reads and applies every rule. Adding the full activity type reference (~250 lines) and the full pipe catalog (~300 lines) would triple the prompt size. The LLM would skim, miss construction rules, and produce more errors.

The injection strategy keeps the prompt focused on what this specific workflow needs. A simple three-step linear workflow gets the base prompt. A multi-workflow composition with escalation gates gets the base prompt plus await, signal, hook web-hook mode, and conditional transitions. The prompt grows with complexity, not unconditionally.

### Refinement Loop

When a built workflow fails testing, the `REFINE_PROMPT` guides correction. The refinement prompt can also inject activity-type references that the initial build missed — if the failure is an incorrect await configuration, the await reference is added to the refinement context. The system learns which references each workflow type needs through the feedback loop.

### Enrichments to the Existing Prompt

Based on the full HotMesh documentation, these additions improve accuracy without significant length:

1. **Conditional transitions.** Add a section showing multi-target transitions with `conditions`:
   ```yaml
   transitions:
     check_status:
       - to: handle_error
         conditions:
           code: 500
       - to: proceed
   ```
   This is essential for branching workflows and currently undocumented.

2. **Extended pipe operators in the abbreviated list.** Add: `@string.endsWith`, `@string.startsWith`, `@string.padStart`, `@string.replace`, `@array.join`, `@array.sort`, `@array.slice`, `@object.create`, `@object.assign`, `@object.entries`, `@object.fromEntries`, `@conditional.nullish`, `@conditional.equality`, `@conditional.strict_equality`, `@number.isInteger`, `@number.parseFloat`, `@number.parseInt`, `@number.toFixed`. These appear frequently in real workflow specifications and their absence forces workarounds.

3. **Hook sleep mode.** The existing prompt mentions hook as "durable pause point" but doesn't show the sleep configuration. Add: `sleep: 5` for fixed delays, `@pipe` expression for dynamic delays.

4. **`stats` on trigger.** Custom job IDs and key-based lookups are needed for idempotent workflows. Add the `stats.id` and `stats.key` pattern.

5. **`await: false` pattern.** Fire-and-forget child workflows are common in composition. A one-line addition to the hook/cycle section would cover it: "For fire-and-forget child workflows, use `type: await` with `await: false`."

These additions total roughly 30 lines — minimal prompt growth for significant capability gain.

---

## What This Enables

An engineer with a specification — a PRD, a TDD, a markdown document describing a multi-step operational process — pastes it into the builder and gets back a coordinated set of deterministic workflows. Leaf workflows call MCP tools. Composition workflows orchestrate leaves. Human-in-the-loop gates pause for review. Payer-specific branches route correctly. The full system deploys as a set of tools that other workflows can compose further.

The specification is the input. The compiled DAGs are the output. Plan mode is the compiler that bridges the gap. The engineer reviews and adjusts at every step — this isn't autonomous generation. It's assisted decomposition, where the LLM handles the YAML construction and the engineer handles the architectural decisions.

The citizen developer illusion dissolves. What remains is an engineer who understands the domain, understands composition, and has a tool that translates specifications into executable workflows without writing YAML by hand. The tool handles the syntax. The engineer handles the semantics.

And because every compiled workflow is an MCP tool, the output of one plan can be the input of another. A set of referral intake workflows becomes a tool that a scheduling system calls. A set of payer verification workflows becomes a tool that an eligibility checker calls. Compositions compose. Plans reference the output of prior plans. The system grows in the same way the organization's operational knowledge grows — incrementally, accretively, each new capability building on the last.
