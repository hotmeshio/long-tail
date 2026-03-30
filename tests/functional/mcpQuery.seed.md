# mcpQuery — Seed Doc for Compilation Tutorial

## Golden Path

The mcpQuery functional test proves the full compilation lifecycle:

1. **Dynamic execution** — A natural language prompt is submitted. The LLM discovers tools from 9+ MCP servers via tag-based search, selects and sequences them, and executes with every call checkpointed.

2. **Compilation** — The execution trace is analyzed through five stages (extract, analyze, compile, build, validate). Per-server compile hints guide wiring. Output: a deterministic YAML DAG with activity manifest, input schema, and data-flow edges.

3. **Deterministic replay** — The compiled workflow deploys as a live MCP tool. A test run verifies output equivalence against the original dynamic execution.

4. **Automatic routing** — The same prompt is re-submitted through the `mcpQueryRouter`. The router discovers the compiled workflow via FTS + tags, an LLM judge confirms scope, and the request routes to the deterministic path.

## Screenshot Moments

Each wizard panel represents a state transition worth capturing:

| Panel | What to show | Why it matters |
|-------|-------------|----------------|
| 1. Original | Dynamic run input/output | Reference point — the "before" |
| 2. Timeline | Swimlane visualization | Makes the LLM's strategy visible |
| 3. Profile | Filled form before compile | Shows how the workflow gets its identity |
| 4. Deploy | YAML config before activation | The deterministic DAG, readable |
| 5. Test (modal) | Invocation modal mid-execution | Live activity timeline — the "during" |
| 5. Test (compare) | Side-by-side after completion | The payoff — same output, no LLM |
| 6. Verify | Router result with badge | Proof the loop closes |

## Storytelling Principles

- **Let the architecture speak.** Describe what happens, not how impressive it is. The comparison table (dynamic vs deterministic) does the persuading.
- **Follow the test's phases.** The tutorial narrative should mirror the functional test's sequential steps — if the test proves it, the doc explains it.
- **Data over adjectives.** Token counts, execution times, and tool-call counts carry more weight than words like "powerful" or "seamless."
- **The closing metaphor is accumulation.** Each compiled workflow is itself a tool. The inventory grows. The long tail gets shorter.

## Companion Files

| File | Purpose |
|------|---------|
| `tests/functional/mcpQuery.test.ts` | Functional test — the assertions |
| `tests/functional/mcpQuery.screenshots.ts` | Screenshot companion — the images |
| `tests/functional/mcpQuery.seed.md` | This file — the storytelling guide |
| `docs/compilation.md` | The tutorial output |
