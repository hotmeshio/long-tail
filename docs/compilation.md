# The Compilation Pipeline

Every AI-driven execution carries cost. An LLM reasons through each step, selects tools, interprets results, and decides what to do next. It works, but it is slow, non-deterministic, and consumes tokens on every run.

Long Tail records what the LLM did, extracts the pattern, and compiles it into a deterministic workflow. The next time the same problem appears, it runs without an LLM — no reasoning, no token cost, same result.

This guide follows a single query through the full lifecycle: dynamic execution, compilation, deterministic replay, and automatic routing. All steps take place in the dashboard's **Pipeline Designer** page (sidebar: **MCP Workflows → Pipeline Designer**).

---

## The Dynamic Execution

Open **Pipeline Designer** from the sidebar. The page lists previous MCP query runs and provides a prompt field to start a new one. Describe what you need in natural language — for example, "Log into the dashboard, discover all navigation pages, and screenshot each one." Optionally constrain which MCP tool tags to search.

When the query is submitted, the `mcpQuery` workflow starts. It discovers available tools by tag (GIN-indexed full-text search), then enters an agentic loop: the LLM selects a tool, calls it, reads the result, and decides the next step. Every tool call is checkpointed by the workflow engine. If the process crashes mid-execution, it resumes from the last checkpoint — no work is lost, no step runs twice.

The run appears in the **Pipeline Designer** list once it completes. Click into it to open the **Compilation Wizard**.

---

## The Compilation Wizard

The wizard has six steps, shown as numbered circles in a sticky bar at the top of the page. Each step represents one stage of converting the dynamic execution into a deployable deterministic workflow:

1. **Describe**
2. **Discover**
3. **Compile**
4. **Deploy**
5. **Test**
6. **Verify**

Steps unlock sequentially — you must complete each before advancing.

### 1. Describe

**Subtitle:** *Dynamic LLM-orchestrated execution — the discovery run*

The first panel displays what the LLM produced: the input envelope on the left and the structured output on the right. Duration is shown. This is the reference point — whatever the compiled workflow produces will be compared against it.

### 2. Discover

**Subtitle:** *Activity swimlane showing tool calls and their durations*

A swimlane visualization of the execution. Each row is an MCP server, each block is a tool call, positioned on a time axis. The pattern is visible at a glance: the LLM logged in, extracted navigation links, then looped through each page to capture a screenshot.

### 3. Compile

**Subtitle:** *Define the deterministic workflow tool from this execution*

The workflow needs an identity. This panel presents a form with:

- **Namespace** — a required alphanumeric identifier for the workflow's application scope.
- **Tool Name** — the workflow's MCP tool name for discovery. This is how other agents and workflows will find and invoke it.
- **Description** — auto-generated from the execution trace. Editable.
- **Tags** — suggested from the execution trace. Add or remove tags to control discoverability.

An optional **Refine compilation** toggle reveals a feedback textarea where you can provide additional instructions to the compiler.

Clicking **Compile Pipeline** triggers the five-stage compilation pipeline:

1. **Extract** — parse the execution trace into an ordered step sequence
2. **Analyze** — detect iteration patterns (the screenshot loop), classify inputs as dynamic (user-provided) or fixed (implementation detail)
3. **Compile** — an LLM produces a blueprint with data-flow edges and session threading, guided by per-server **compile hints** stored in the database (e.g., which output fields to use as transform sources, how to thread browser session handles)
4. **Build** — generate a deterministic YAML DAG with activity wiring
5. **Validate** — check for missing wiring, lost session handles, broken iteration boundaries

Once compilation succeeds, the panel switches to a read-only view showing the workflow name, status badge, namespace, topic, description, activity pipeline chain, and tags.

### 4. Deploy

**Subtitle:** *Review configuration, input/output schemas, and YAML definition*

The deploy panel displays the compiled YAML definition, input schema, and output schema. The YAML encodes the DAG: each step names an MCP tool, declares its inputs (either from the user's request or from a prior step's output), and specifies data-flow edges.

Two toggle buttons are available:

- **Recompile with Feedback** — provide notes to the compiler and regenerate the YAML.
- **Manual Edit** — directly edit the YAML, schemas, or activity manifest.

A version history panel on the right tracks all edits. The step label changes from "Deploy" to "Redeploy" when the workflow is already active.

Clicking **Deploy & Activate** registers the workflow as a live MCP tool — tagged for discovery, versioned, invocable by any agent, workflow, or API call.

### 5. Test

**Header:** *Compare Runs*

The test panel runs the compiled workflow and compares it against the original dynamic execution. Two columns show:

- **Left — Original MCP Query**: the dynamic LLM-orchestrated run with its input, output, and duration.
- **Right — Compiled Pipeline Run**: the deterministic run with its input, output, and duration. A dropdown allows selecting from multiple test runs.

Click **Run Test** to invoke the compiled workflow with the original input. An invocation modal appears with the pre-populated input schema.

The difference is structural:

| | Dynamic (LLM) | Deterministic |
|---|---|---|
| **Tool calls** | N (LLM selects each) | 1 pipeline (pre-wired DAG) |
| **LLM usage** | Every step | Route + input extraction only |
| **Determinism** | Varies per run | Identical every time |

The deterministic path is faster because the LLM is used only at the edges — routing the request and extracting structured inputs from the prompt. The DAG itself executes tool calls directly with pre-wired data flow. No per-step reasoning, no tool selection, no interpretation.

### 6. Verify

**Header:** *End-to-End Verification*

The final panel confirms end-to-end routing. The original prompt is pre-filled in an editable textarea on the left. Click **Submit** to send it through the `mcpQueryRouter` — the same entry point any future request would use. A **Reset to original** button restores the prompt if you modify it.

The right column shows the result: a status badge, confidence percentage (when the deterministic path is used), and the full output in a JSON viewer. A **RouterProgressTracker** displays real-time routing progress during execution.

The router performs full-text search and tag matching to find candidate workflows, then uses an LLM judge to confirm scope. When confidence exceeds the threshold, the request goes straight to the compiled workflow.

```
User prompt → Router → Discovery (FTS + tags) → LLM Judge
                 │                                    │
                 │  confidence ≥ 0.7                  │  no match
                 ▼                                    ▼
            Deterministic                          Dynamic
        (compiled DAG, no LLM)                  (agentic loop)
```

---

## How It Accumulates

The first time a problem appears, the dynamic path runs. An LLM reasons through it — slow and expensive, but it works.

The wizard compiles the solution into a deterministic pipeline. A human reviews the DAG, adjusts if needed, and deploys.

Every subsequent occurrence is routed automatically. A single LLM call extracts structured inputs from the prompt, then the DAG executes without further reasoning.

Each compiled workflow is itself a discoverable MCP tool. Other workflows and agents can invoke it. Solutions compose. The inventory of deterministic pathways grows with every problem the system solves, and the fraction of requests that require LLM reasoning shrinks.

The dynamic path remains for genuinely new problems. But the long tail gets shorter.
