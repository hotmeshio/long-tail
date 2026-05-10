# The Workflow Compiler

You wrote a durable workflow. It works. `proxyActivities`, `sleep`, `condition` — the Temporal-like API is productive and familiar. But under the hood, the durable engine replays the entire workflow function on every wake-up. Sleep three times in a ten-step workflow? Steps 1–3 replay on wake one. Steps 1–6 replay on wake two. Steps 1–9 replay on wake three. The replay is deterministic — it skips completed activities — but the function still executes from the top every time.

The compiled YAML DAG does the same work without replay. Each step fires exactly once. State flows explicitly between activities through input mappings. No function re-execution, no replay loop, no wasted cycles.

`ltc` is the compiler. It reads your TypeScript source and produces an equivalent YAML DAG. Write procedural because it's productive. Run the DAG because it's fast.

---

## The Analogy

`tsc` compiles TypeScript to JavaScript. You write in the language that's expressive. You run the artifact that's efficient. The source is authoritative — you edit it, test it, review it. The compiled output is what actually executes.

`ltc` does the same for workflows:

```
  TypeScript source       ltc compile        YAML DAG
  (developer-friendly) ──────────────────→ (execution-optimized)

  assembly-line.ts     →   assembly-line.compiled.yaml
```

The `.ts` file is the spec. The `.compiled.yaml` is the optimized execution. Both live in the repo. A reviewer reads both side-by-side and traces every line of orchestration logic to its DAG equivalent.

---

## Quick Start

```bash
npm install -g @hotmeshio/long-tail
export ANTHROPIC_API_KEY=sk-ant-...

ltc compile workflows/basic-echo/index.ts
```

Output:

```
  ✓ index.ts → workflows/basic-echo/index.compiled.yaml
    1 activities · 2 inputs (message, sleepSeconds) · topic: basic.echo

  Compiled 1 workflow in 18.1s
```

The compiled YAML appears adjacent to the source file.

---

## Before and After

### The source (procedural)

```typescript
import { Durable } from '@hotmeshio/hotmesh';
import * as activities from './activities';

const { echo } = Durable.workflow.proxyActivities<typeof activities>({
  activities,
});

export async function basicEcho(envelope: LTEnvelope): Promise<any> {
  const { message = 'Hello, Long Tail!', sleepSeconds = 1 } = envelope.data;

  // 1. Durable sleep — the engine replays to this point on wake-up
  await Durable.workflow.sleep(`${sleepSeconds} seconds`);

  // 2. Activity call — replayed as a no-op if already completed
  const echoResult = await echo({ message });

  return {
    type: 'return' as const,
    data: { ...echoResult, sleepSeconds, userId: envelope.lt?.userId },
  };
}
```

This function executes three times: once on initial invocation, once when the sleep timer fires, and once when the echo activity completes. Each time, the engine replays from the top, skipping completed steps. For a two-step workflow this is fine. For a twenty-step workflow with multiple sleeps, the replay cost compounds.

### The compiled output (DAG)

```yaml
app:
  id: longtail
  version: '1'
  graphs:
    - subscribes: basic.echo
      expire: 300
      input:
        schema:
          type: object
          properties:
            message:
              type: string
              default: 'Hello, Long Tail!'
            sleepSeconds:
              type: number
              default: 1
      activities:
        trigger_m7qz:
          type: trigger
          output:
            schema:
              type: object
              properties:
                message: { type: string }
                sleepSeconds: { type: number }

        delay_m7qz:
          type: hook
          sleep: '{trigger_m7qz.output.data.sleepSeconds}'

        echo_m7qz:
          type: worker
          topic: basic.echo
          input:
            maps:
              message: '{trigger_m7qz.output.data.message}'
              workflowName: echo

      transitions:
        trigger_m7qz:
          - to: delay_m7qz
        delay_m7qz:
          - to: echo_m7qz
```

### The mapping

| TypeScript | YAML | What happens |
|---|---|---|
| `envelope.data` destructuring | `trigger` activity with input schema | Inputs declared as typed schema with defaults |
| `Durable.workflow.sleep(N)` | `hook` activity with `sleep` field | Engine sets a timer; no replay on wake |
| `await echo({ message })` | `worker` activity with input `maps` | Worker fires once; result stored in job hash |
| `return { data: ... }` | `job.maps` on the final activity | Output fields plucked from activity results |

Each step executes exactly once. The `sleep` hook pauses the DAG. When the timer fires, execution resumes at `echo_m7qz` — not from the top of the function.

---

## Discovery

Point `ltc` at a directory and it finds workflow files automatically:

```bash
ltc compile examples/workflows/ --dry-run
```

```
  Found 10 workflows:

  ● assembly-line/index.ts
    Function: assemblyLine  ·  HotMesh Durable
    Control flow: startChild, condition

  ● basic-echo/index.ts
    Function: basicEcho  ·  HotMesh Durable
    Activities: echo
    Control flow: sleep

  ● basic-signal/index.ts
    Function: basicSignal  ·  HotMesh Durable
    Activities: ltCreateEscalation, processApproval
    Control flow: conditionLT

  ● kitchen-sink/index.ts
    Function: kitchenSink  ·  HotMesh Durable
    Activities: greet, fetchData, transformData, notifyComplete
    Control flow: sleep, executeLT
```

### What the scanner looks for

| Pattern | Classification |
|---|---|
| `proxyActivities` / `Durable.workflow.proxyActivities` | HotMesh Durable workflow |
| `@temporalio/workflow` import | Temporal workflow |
| `sleep`, `condition`, `signal` | Control flow primitives |
| `startChild`, `executeChild`, `executeLT` | Composition (parent workflow) |
| Exported async function | Workflow entry point |

Files in `node_modules/`, `build/`, `dist/`, and test files (`*.test.ts`, `*.spec.ts`) are excluded.

---

## How Compilation Works

The compiler is not an AST parser. It uses the LLM to translate orchestration logic, grounded by structural metadata extracted from the source.

1. **Read source** — file or inline string
2. **Extract metadata** — lightweight regex extraction: activity names, durable primitives, envelope fields, import paths, control flow markers (loops, Promise.all, conditionals, escalation)
3. **Resolve activities** — if the source imports activity modules, the compiler reads them too and includes them in the LLM context
4. **LLM translation** — the source code, extracted metadata, and the full HotMesh YAML specification are sent to the LLM. Temperature 0. Up to 3 retry attempts on parse failure.
5. **Fix patterns** — known LLM anti-patterns in YAML pipe expressions are corrected deterministically

The metadata extraction is intentionally lightweight — regex, not a TypeScript AST. It gives the LLM structural hints (which functions are activities, which primitives are used) without requiring `ts-morph` or the TypeScript compiler API as a dependency.

---

## Composition

When a workflow uses `startChild` or `executeChild`, the compiler resolves the child workflow source through imports and compiles children first (leaf-first ordering). The parent's compiled YAML references each child by topic using the `await` activity type — the same mechanism used by the Pipeline Designer's Plan Build mode.

```
parent.ts  ──→  parent.compiled.yaml
  └─ startChild(worker)
       └─ worker.ts  ──→  worker.compiled.yaml
```

All compiled workflows in the same composition share the same `app.id` namespace, enabling cross-graph invocation.

---

## Three Surfaces

The compiler is the same function regardless of how you invoke it.

### CLI

```bash
ltc compile workflows/assembly-line.ts
ltc compile src/workflows/ --dry-run
ltc compile --model claude-sonnet-4-6
```

### HTTP API

```bash
curl -X POST http://localhost:3000/api/yaml-workflows/from-durable \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "export async function basicEcho(envelope) { ... }",
    "workflow_name": "basicEcho",
    "name": "basic_echo"
  }'
```

### SDK

```typescript
import { createClient } from '@hotmeshio/long-tail/sdk';

const lt = createClient({ auth: { userId: 'system' } });

const result = await lt.yamlWorkflows.compileDurable({
  source: fs.readFileSync('workflows/assembly-line.ts', 'utf-8'),
  workflow_name: 'assemblyLine',
  name: 'assembly_line',
});
```

The CLI writes `.compiled.yaml` files to disk. The HTTP and SDK surfaces store the compiled workflow in the database and return the record. All three use the same underlying `compileDurableToYaml()` function.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for Claude models |
| `OPENAI_API_KEY` | — | Required for OpenAI models |
| `LT_LLM_MODEL_PRIMARY` | `claude-sonnet-4-6` | Model used for compilation |
| `LT_LLM_BASE_URL` | — | Custom endpoint for OpenAI-compatible models |

The CLI loads `.env` automatically if present in the current directory.

---

## CLI Reference

```
Usage: ltc compile [options] [target]

Compile durable TypeScript workflows to YAML DAGs

Arguments:
  target                  File or directory to compile (default: current directory)

Options:
  --dry-run               Show discovered workflows without compiling
  -o, --output <dir>      Output directory (default: adjacent to source file)
  --model <model>         LLM model to use (default: claude-sonnet-4-6)
  --function <name>       Workflow function name (auto-detected if omitted)
  -h, --help              Display help
```

### Examples

```bash
# Compile a single file
ltc compile workflows/basic-echo/index.ts

# Scan and compile all workflows in a directory
ltc compile src/workflows/

# Compile everything in the current directory
ltc compile

# Preview what would be compiled
ltc compile examples/workflows/ --dry-run

# Use a specific model
ltc compile workflows/complex.ts --model claude-opus-4-6

# Write output to a separate directory
ltc compile workflows/ -o compiled/

# Compile a specific function from a multi-export file
ltc compile workflows/multi.ts --function assemblyLine
```
