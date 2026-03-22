/**
 * Compile stage: LLM-powered intent compilation.
 *
 * Calls an LLM to review the execution steps + original prompt and produce
 * an EnhancedCompilationPlan — a rich specification including iteration specs,
 * data flow graphs, key mappings, and session field identification.
 *
 * This replaces the shallow compiler-llm.ts that only classified inputs.
 */

import { callLLM, hasLLMApiKey } from '../../llm';
import { LLM_MODEL_PRIMARY } from '../../../modules/defaults';
import type { InputFieldMeta } from '../../../types/yaml-workflow';
import type { PatternAnnotation } from '../pattern-detector';
import type {
  ExtractedStep,
  EnhancedCompilationPlan,
  IterationSpec,
  DataFlowEdge,
  StepSpec,
  PipelineContext,
} from './types';

// ── Step summarization for LLM context ────────────────────────────────────────

interface StepSummary {
  index: number;
  kind: 'tool' | 'llm';
  toolName: string;
  server?: string;
  argumentKeys: string[];
  arguments: Record<string, unknown>;
  resultKeys: string[];
  /** Truncated result structure showing arrays and nested objects. */
  resultSample: unknown;
  /** If this step has _iteration metadata from pattern detector. */
  iterationMeta?: {
    tool: string;
    count: number;
    varyingKeys: string[];
    constantArgs: Record<string, unknown>;
    arraySource: { stepIndex: number; field: string } | null;
  };
}

/** Truncate a value for display in the LLM prompt. */
function truncateValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length <= 2) return value;
    return `[${value.length} items]`;
  }
  if (typeof value === 'string' && value.length > 200) {
    return value.slice(0, 200) + '...';
  }
  if (typeof value === 'object' && value !== null) {
    const str = JSON.stringify(value);
    if (str.length > 300) return str.slice(0, 300) + '...';
    return value;
  }
  return value;
}

/**
 * Truncate an object's values for LLM context, preserving structure.
 */
function truncateObject(obj: Record<string, unknown>, maxDepth = 2): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        result[key] = [];
      } else if (value.length <= 2) {
        result[key] = value.map(v =>
          v && typeof v === 'object' && !Array.isArray(v) && maxDepth > 1
            ? truncateObject(v as Record<string, unknown>, maxDepth - 1)
            : truncateValue(v),
        );
      } else {
        // Show array structure: type, length, and first item's keys
        const firstItem = value[0];
        if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
          result[key] = {
            _type: 'array',
            _length: value.length,
            _itemKeys: Object.keys(firstItem as Record<string, unknown>),
            _firstItem: maxDepth > 1
              ? truncateObject(firstItem as Record<string, unknown>, maxDepth - 1)
              : `{${Object.keys(firstItem as Record<string, unknown>).join(', ')}}`,
          };
        } else {
          result[key] = { _type: 'array', _length: value.length, _itemType: typeof firstItem };
        }
      }
    } else if (value && typeof value === 'object' && maxDepth > 1) {
      result[key] = truncateObject(value as Record<string, unknown>, maxDepth - 1);
    } else {
      result[key] = truncateValue(value);
    }
  }
  return result;
}

/**
 * Summarize extracted steps for the LLM, including result structure.
 */
function summarizeSteps(steps: ExtractedStep[]): StepSummary[] {
  return steps.map((step, index) => {
    const args: Record<string, unknown> = {};
    let iterationMeta: StepSummary['iterationMeta'] = undefined;

    for (const [key, value] of Object.entries(step.arguments)) {
      if (key === '_iteration') {
        const iter = value as Record<string, unknown>;
        iterationMeta = {
          tool: iter.tool as string,
          count: iter.count as number,
          varyingKeys: iter.varyingKeys as string[],
          constantArgs: iter.constantArgs as Record<string, unknown>,
          arraySource: iter.arraySource as { stepIndex: number; field: string } | null,
        };
      } else if (Array.isArray(value) && value.length > 3) {
        args[key] = `[Array of ${value.length} items, first: ${JSON.stringify(value[0]).slice(0, 200)}]`;
      } else if (typeof value === 'string' && value.length > 300) {
        args[key] = value.slice(0, 300) + '...';
      } else {
        args[key] = value;
      }
    }

    // Build result sample showing structure (not just keys)
    let resultSample: unknown = null;
    if (step.result && typeof step.result === 'object') {
      if (Array.isArray(step.result)) {
        resultSample = {
          _type: 'array',
          _length: step.result.length,
          _firstItem: step.result[0] && typeof step.result[0] === 'object'
            ? truncateObject(step.result[0] as Record<string, unknown>)
            : step.result[0],
        };
      } else {
        resultSample = truncateObject(step.result as Record<string, unknown>);
      }
    }

    const resultKeys = step.result && typeof step.result === 'object' && !Array.isArray(step.result)
      ? Object.keys(step.result as Record<string, unknown>)
      : [];

    return {
      index,
      kind: step.kind,
      toolName: step.toolName,
      server: step.mcpServerId,
      argumentKeys: Object.keys(step.arguments).filter(k => k !== '_iteration'),
      arguments: args,
      resultKeys,
      resultSample,
      ...(iterationMeta ? { iterationMeta } : {}),
    };
  });
}

// ── LLM prompt ────────────────────────────────────────────────────────────────

const COMPILATION_PROMPT = `You are a workflow compiler. You analyze MCP tool execution traces and produce a COMPILATION PLAN — a complete specification for building a deterministic YAML DAG workflow.

Given:
1. The user's ORIGINAL PROMPT — the single most important signal for understanding intent
2. EXECUTION STEPS — tool calls with arguments, result structure samples, and server IDs
3. PATTERN ANNOTATIONS — pre-detected iteration candidates from static analysis
4. NAIVE INPUT CLASSIFICATION — initial argument classification

Your job: produce a plan that makes the workflow truly reusable and deterministic.

## Critical: Understand Intent

The original prompt describes what the user wanted. The execution trace shows HOW an LLM accomplished it, but may include exploratory detours. Your compilation captures INTENT, not a blind replay.

For example, if the prompt says "login to site X and take screenshots of all pages":
- INTENT: login → discover pages → iterate and screenshot each one
- Execution may have included probing steps — exclude those
- Deterministic version: accept credentials → login → extract links → iterate taking screenshots

## Rules

### Step Dispositions
- **core**: Directly serves the workflow intent. Produces data consumed by later steps.
- **exploratory**: Probing/debugging/discovery steps that don't produce data needed by the workflow. Exclude these:
  - Checking if compiled workflows exist (list_workflows, list_yaml_workflows)
  - Listing files to see what exists (list_files, read_file)
  - Initial tool calls that failed and were retried with different parameters
  - Any step whose result is not consumed by a subsequent core step

### Iteration Specifications
When the execution shows repeated tool calls with varying arguments (the pattern detector may have already collapsed these):
- Identify the SOURCE: which prior step's result contains the array being iterated. This is the step that PRODUCED the list of items — look for a step whose result contains an array field with items matching the iteration's varying values. For example, if the iteration visits multiple URLs, find the step that returned those URLs (e.g., extract_content with links).
- The source is NEVER a step that doesn't have the array in its output. Double-check: does the source step's resultKeys include the source_field?
- Specify the source_field: the dot-path to the array (e.g., "links", "results.pages")
- List varying_keys (change per item) vs constant_args (shared)
- **KEY MAPPINGS are critical**: array items often use different key names than the tool expects.
  E.g., extract_content returns \`links: [{text, href}, ...]\` but the screenshot tool wants \`url\`.
  Map: \`{ "url": "href" }\` — tool arg name → array item key name.
  Use null for keys that are COMPUTED at runtime, not sourced from the array.
  For example, screenshot_path is often derived from the link text or URL — it's not a field in the source array directly:
  \`{ "screenshot_path": null }\` — the value must be computed or provided by the trigger.

### Data Flow Graph
Specify directed edges showing how data flows between steps:
- from_step: "trigger" (user input) or step index number
- from_field: the output field name (or trigger input key)
- to_step: the consuming step index
- to_field: the argument key name
- is_session_wire: true for session handles (page_id, _handle, session_id)

Session handles are critical — they maintain authenticated browser sessions, database connections, etc. They must be threaded from their producer through ALL subsequent steps that need them.

### Input Classification
- **dynamic**: Values callers MUST provide: URLs, credentials, paths, queries, search terms
- **fixed**: Implementation details with sensible defaults: selectors, timeouts, boolean flags

Flatten nested objects containing dynamic values. E.g., \`login: {url, username, password}\` → separate \`login_url\`, \`username\`, \`password\` fields.

Don't hardcode execution-specific arrays. Arrays of items (18 URLs, list of pages) should be dynamic.

### Session Fields and Threading Rules
List all fields that represent session tokens/handles that must flow through the DAG (e.g., page_id, _handle, session_id).

**Critical**: When a login/setup step produces a page_id or _handle, ALL subsequent browser/page steps must receive that session wire — including steps inside iterations. The data_flow graph must include session wire edges from the producing step to EVERY downstream step that operates on the same session, not just the immediately next one. For iterations: wire the session from the setup step directly to the iteration body step.

## Output Format

Return a JSON object (no markdown fences):
{
  "intent": "Brief generic description of what this workflow does",
  "description": "Suggested workflow description for discovery",
  "steps": [
    { "index": 0, "purpose": "Navigate to the target site", "disposition": "core" },
    { "index": 1, "purpose": "Extract navigation links from the page", "disposition": "core" },
    { "index": 2, "purpose": "List files to check directory structure", "disposition": "exploratory" }
  ],
  "core_step_indices": [0, 1, 3],
  "inputs": [
    { "key": "base_url", "type": "string", "classification": "dynamic", "description": "The base URL of the site" },
    { "key": "username", "type": "string", "classification": "dynamic", "description": "Login username" },
    { "key": "timeout", "type": "number", "classification": "fixed", "description": "Page load timeout", "default": 30000 }
  ],
  "iterations": [
    {
      "body_step_index": 3,
      "tool_name": "screenshot",
      "server_id": "playwright",
      "source_step_index": 1,
      "source_field": "links",
      "varying_keys": ["url", "screenshot_path"],
      "constant_args": { "full_page": true },
      "key_mappings": { "url": "href", "screenshot_path": null }
    }
  ],
  "data_flow": [
    { "from_step": "trigger", "from_field": "base_url", "to_step": 0, "to_field": "url", "is_session_wire": false },
    { "from_step": 0, "from_field": "page_id", "to_step": 1, "to_field": "page_id", "is_session_wire": true },
    { "from_step": 0, "from_field": "_handle", "to_step": 1, "to_field": "_handle", "is_session_wire": true }
  ],
  "session_fields": ["page_id", "_handle"]
}`;

// ── Compile stage ─────────────────────────────────────────────────────────────

/**
 * Apply a compilation plan to override the naive input field metadata.
 */
function applyInputOverrides(
  planInputs: EnhancedCompilationPlan['inputs'],
  naiveInputs: InputFieldMeta[],
): InputFieldMeta[] {
  const naiveByKey = new Map(naiveInputs.map(f => [f.key, f]));

  return planInputs.map(inp => {
    const naive = naiveByKey.get(inp.key);
    return {
      key: inp.key,
      type: inp.type,
      classification: inp.classification,
      description: inp.description,
      ...(inp.classification === 'fixed' && inp.default !== undefined
        ? { default: inp.default }
        : {}),
      source_step_index: naive?.source_step_index ?? 0,
      source_tool: naive?.source_tool ?? 'unknown',
    };
  });
}

/**
 * Parse the LLM's JSON response into an EnhancedCompilationPlan.
 * Handles missing/malformed fields gracefully.
 */
function parsePlan(raw: string, stepCount: number): EnhancedCompilationPlan {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();
  const parsed = JSON.parse(cleaned);

  // Parse steps
  const steps: StepSpec[] = (parsed.steps || []).map((s: any) => ({
    index: typeof s.index === 'number' ? s.index : 0,
    purpose: s.purpose || '',
    disposition: s.disposition === 'exploratory' ? 'exploratory' : 'core',
  }));

  // Parse iterations
  const iterations: IterationSpec[] = (parsed.iterations || []).map((it: any) => ({
    bodyStepIndex: typeof it.body_step_index === 'number' ? it.body_step_index : 0,
    toolName: it.tool_name || '',
    serverId: it.server_id,
    sourceStepIndex: typeof it.source_step_index === 'number' ? it.source_step_index : 0,
    sourceField: it.source_field || 'items',
    varyingKeys: Array.isArray(it.varying_keys) ? it.varying_keys : [],
    constantArgs: it.constant_args && typeof it.constant_args === 'object' ? it.constant_args : {},
    keyMappings: it.key_mappings && typeof it.key_mappings === 'object' ? it.key_mappings : {},
  }));

  // Parse data flow
  const dataFlow: DataFlowEdge[] = (parsed.data_flow || []).map((df: any) => ({
    fromStep: df.from_step === 'trigger' ? 'trigger' : (typeof df.from_step === 'number' ? df.from_step : 0),
    fromField: df.from_field || '',
    toStep: typeof df.to_step === 'number' ? df.to_step : 0,
    toField: df.to_field || '',
    isSessionWire: !!df.is_session_wire,
  }));

  // Parse inputs
  const inputs = (parsed.inputs || []).map((inp: any) => ({
    key: inp.key,
    type: inp.type || 'string',
    classification: inp.classification === 'dynamic' ? 'dynamic' as const : 'fixed' as const,
    description: inp.description || '',
    ...(inp.default !== undefined ? { default: inp.default } : {}),
  }));

  return {
    intent: parsed.intent || '',
    description: parsed.description || '',
    steps,
    coreStepIndices: parsed.core_step_indices || steps
      .filter(s => s.disposition === 'core')
      .map(s => s.index),
    inputs,
    iterations,
    dataFlow,
    sessionFields: Array.isArray(parsed.session_fields) ? parsed.session_fields : [],
    hasIteration: iterations.length > 0 || !!parsed.has_iteration,
  };
}

/**
 * Compile pipeline stage: call LLM to produce an EnhancedCompilationPlan.
 *
 * Falls back gracefully when the LLM is unavailable — the build stage
 * uses mechanical heuristics as before.
 */
export async function compile(ctx: PipelineContext): Promise<PipelineContext> {
  // Attempt LLM compilation
  ctx.compilationPlan = await callCompilationLLM(
    ctx.collapsedSteps,
    ctx.originalPrompt,
    ctx.naiveInputs,
    ctx.patternAnnotations,
  );

  if (ctx.compilationPlan) {
    // Filter to core steps only
    const coreIndices = new Set(ctx.compilationPlan.coreStepIndices);
    if (coreIndices.size > 0 && coreIndices.size < ctx.collapsedSteps.length) {
      ctx.coreSteps = ctx.collapsedSteps.filter((_, idx) => coreIndices.has(idx));
    } else {
      ctx.coreSteps = [...ctx.collapsedSteps];
    }

    // Override input classifications with LLM's refined plan
    ctx.refinedInputs = applyInputOverrides(ctx.compilationPlan.inputs, ctx.naiveInputs);
  } else {
    // No plan — use collapsed steps and naive inputs as-is
    ctx.coreSteps = [...ctx.collapsedSteps];
    ctx.refinedInputs = [...ctx.naiveInputs];
  }

  return ctx;
}

/**
 * Call the LLM to produce an EnhancedCompilationPlan.
 * Returns null if the LLM is unavailable or the call fails.
 */
async function callCompilationLLM(
  steps: ExtractedStep[],
  originalPrompt: string,
  naiveInputs: InputFieldMeta[],
  patternAnnotations: PatternAnnotation[],
): Promise<EnhancedCompilationPlan | null> {
  if (!hasLLMApiKey(LLM_MODEL_PRIMARY)) return null;

  const summaries = summarizeSteps(steps);

  const naiveClassification = naiveInputs.map(f => ({
    key: f.key,
    type: f.type,
    classification: f.classification,
    description: f.description,
    source_tool: f.source_tool,
    ...(f.default !== undefined ? { default_preview: truncateValue(f.default) } : {}),
  }));

  const userMessage = [
    `## Original Prompt`,
    `"${originalPrompt}"`,
    ``,
    `## Execution Steps`,
    JSON.stringify(summaries, null, 2),
    ``,
    ...(patternAnnotations.length > 0 ? [
      `## Pattern Annotations (pre-detected by static analysis)`,
      JSON.stringify(patternAnnotations, null, 2),
      ``,
    ] : []),
    `## Naive Input Classification`,
    JSON.stringify(naiveClassification, null, 2),
  ].join('\n');

  try {
    const response = await callLLM({
      model: LLM_MODEL_PRIMARY,
      max_tokens: 4000,
      temperature: 0,
      messages: [
        { role: 'system', content: COMPILATION_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const raw = response.content || '';
    return parsePlan(raw, steps.length);
  } catch (err) {
    const { loggerRegistry } = await import('../../logger');
    loggerRegistry.warn(`[yaml-workflow] LLM compilation failed, using mechanical fallback: ${err}`);
    return null;
  }
}

// ── Re-exports for backward compatibility ─────────────────────────────────────

/** @deprecated Use EnhancedCompilationPlan from pipeline/types instead. */
export type CompilationPlan = EnhancedCompilationPlan;
