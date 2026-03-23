YAML workflow generation, compilation, and deployment. Converts completed MCP tool execution traces into deterministic HotMesh YAML DAG workflows via an LLM-powered pipeline.

Key files:
- `index.ts` — Barrel export: `db`, `generator`, `deployer`, `workers`
- `generator.ts` — Orchestrates the five-stage compilation pipeline: extract -> analyze -> compile -> build -> validate
- `deployer.ts` — Deploys compiled YAML to HotMesh engines. Manages engine instances per `appId`, handles manifest parsing and worker activation.
- `db.ts` — CRUD for `lt_yaml_workflows` table: create, get, update, delete, list, version snapshots, app discovery
- `sql.ts` — Static SQL constants for workflow CRUD
- `workers.ts` — HotMesh stream worker that processes YAML workflow executions. Bridges MCP tool calls through the LLM service.
- `compiler-llm.ts` — Deprecated re-export; compilation logic moved to `pipeline/`
- `input-analyzer.ts` — Classifies step arguments as dynamic (user-provided), fixed (defaults), or wired (inter-step data)
- `pattern-detector.ts` — Detects structural patterns in step sequences (iteration, repetition) for collapsing into richer YAML structures

Pipeline stages (`pipeline/`):
- `extract.ts` — Extracts ordered tool calls from execution events
- `analyze.ts` — Analyzes step dependencies and data flow
- `compile.ts` — LLM-powered intent analysis producing a compilation plan
- `build.ts` — Generates YAML DAG from the compilation plan
- `validate.ts` — LLM-powered validation of the generated YAML
- `types.ts` — Shared pipeline types (`PipelineContext`, `GenerateYamlOptions`, etc.)

Inline SQL to externalize:
- `db.ts` lines 120, 169, 247-249, 290 — dynamic UPDATE and list pagination queries remain inline due to runtime SQL construction. Static queries are already in `sql.ts`.

Inline LLM prompts to externalize:
- `pipeline/compile.ts` line 208 — `COMPILATION_PROMPT` (large system prompt for workflow compilation)
- `pipeline/validate.ts` line 13 — `VALIDATION_PROMPT` (system prompt for YAML validation)
- `pipeline/extract.ts` line 97 — inline system prompt for data analysis
These should move to a `prompts.ts` file following the project convention (see `system/workflows/*/prompts.ts`).
