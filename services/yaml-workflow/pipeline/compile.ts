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
} from '../types';
import { COMPILATION_PROMPT } from './prompts';

// ── Step summarization for LLM context ────────────────────────────────────────

interface StepSummary {
  index: number;
  kind: 'tool' | 'llm' | 'signal';
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
  // Pre-compute array outputs from all steps for provenance detection
  const arrayOutputs: Array<{ stepIndex: number; field: string; items: unknown[] }> = [];
  for (let i = 0; i < steps.length; i++) {
    const result = steps[i].result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      for (const [field, value] of Object.entries(result as Record<string, unknown>)) {
        if (Array.isArray(value) && value.length > 0) {
          arrayOutputs.push({ stepIndex: i, field, items: value });
        }
      }
    }
  }

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
        // Check if this array was likely derived from a prior step's output
        let provenance = '';
        for (const ao of arrayOutputs) {
          if (ao.stepIndex >= index) continue; // only prior steps
          if (ao.items.length > 0 && value.length > 0) {
            // Check if array items share values (e.g., URLs overlap)
            const sourceValues = new Set<string>();
            for (const item of ao.items) {
              if (item && typeof item === 'object') {
                for (const v of Object.values(item as Record<string, unknown>)) {
                  if (typeof v === 'string') sourceValues.add(v);
                }
              }
            }
            const targetValues: string[] = [];
            for (const item of value) {
              if (item && typeof item === 'object') {
                for (const v of Object.values(item as Record<string, unknown>)) {
                  if (typeof v === 'string') targetValues.push(v);
                }
              }
            }
            const overlap = targetValues.filter(v => sourceValues.has(v)).length;
            if (overlap > value.length * 0.3) {
              provenance = ` ⚠️ DERIVED FROM step ${ao.stepIndex} field "${ao.field}" (${overlap} overlapping values — this is NOT a user input, it was computed from step ${ao.stepIndex}'s output)`;
              break;
            }
          }
        }
        args[key] = `[Array of ${value.length} items, first: ${JSON.stringify(value[0]).slice(0, 200)}]${provenance}`;
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
  const dataFlow: DataFlowEdge[] = (parsed.data_flow || []).map((df: any) => {
    const edge: DataFlowEdge = {
      fromStep: df.from_step === 'trigger' ? 'trigger' : (typeof df.from_step === 'number' ? df.from_step : 0),
      fromField: df.from_field || '',
      toStep: typeof df.to_step === 'number' ? df.to_step : 0,
      toField: df.to_field || '',
      isSessionWire: !!df.is_session_wire,
    };
    // Parse transform spec if present — normalize snake_case from LLM to camelCase
    if (df.transform && typeof df.transform === 'object') {
      const rawDerivations = df.transform.derivations as Record<string, any> | undefined;
      const derivations = rawDerivations
        ? Object.fromEntries(
            Object.entries(rawDerivations).map(([k, v]) => [k, {
              sourceKey: v.source_key || v.sourceKey || '',
              strategy: v.strategy || 'passthrough',
              ...(v.prefix ? { prefix: v.prefix } : {}),
              ...(v.suffix ? { suffix: v.suffix } : {}),
              ...(v.template ? { template: v.template } : {}),
            }]),
          )
        : undefined;
      edge.transform = {
        fieldMap: df.transform.field_map && typeof df.transform.field_map === 'object'
          ? df.transform.field_map : {},
        ...(df.transform.defaults ? { defaults: df.transform.defaults } : {}),
        ...(derivations ? { derivations } : {}),
      };
    }
    return edge;
  });

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
  // Build retry context if this is a recompilation after a failed deployment or validation
  const retryHint = ctx.priorDeployError
    ? [
        `\n## RECOMPILATION — Prior Attempt Failed`,
        `The previous compilation produced YAML that failed with this error:`,
        `> ${ctx.priorDeployError}`,
        ``,
        `You MUST produce a plan that avoids this issue. Specifically:`,
        `- If the error mentions input key mismatches (e.g., 'login.url' vs 'url'), ensure your`,
        `  dataFlow edges use the exact field names each tool expects as inputs.`,
        `- If the error mentions missing input wiring or session handles, ensure all data dependencies`,
        `  (including _handle, page_id, and other session fields) are explicitly wired in dataFlow edges.`,
        `- If the error mentions "Duplicate activity id", ensure all activity IDs will be unique.`,
        `- If the error mentions invalid transitions, ensure data flow edges reference valid step indices.`,
        `- Review the failed YAML below for the specific structural issue and ensure your plan avoids it.`,
        ...(ctx.priorFailedYaml ? [
          ``,
          `### Failed YAML (excerpt)`,
          '```yaml',
          ctx.priorFailedYaml.slice(0, 2000),
          '```',
        ] : []),
      ].join('\n')
    : undefined;

  // Attempt LLM compilation
  ctx.compilationPlan = await callCompilationLLM(
    ctx.collapsedSteps,
    ctx.originalPrompt,
    ctx.naiveInputs,
    ctx.patternAnnotations,
    retryHint,
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
 * Gather the full tool inventory and compile hints for MCP servers used in the execution trace.
 * Returns both the tool inventory (for substitution) and per-server compile hints (for context).
 */
async function gatherServerToolInventory(
  steps: ExtractedStep[],
): Promise<{ inventory: string; compileHints: string }> {
  const serverIds = new Set<string>();
  for (const step of steps) {
    if (step.mcpServerId) serverIds.add(step.mcpServerId);
  }
  if (serverIds.size === 0) return { inventory: '', compileHints: '' };

  try {
    const mcpDbService = await import('../../mcp/db');
    const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
    const relevant = servers.filter((s: any) => serverIds.has(s.name));

    const inventoryLines: string[] = [];
    const hintLines: string[] = [];
    for (const server of relevant) {
      const tools = (server.tool_manifest || []).map((t: any) => {
        const params = t.inputSchema?.properties
          ? Object.entries(t.inputSchema.properties as Record<string, any>)
              .map(([k, v]: [string, any]) => `${k}: ${v.type || '?'}`)
              .join(', ')
          : '';
        return `    - ${t.name}(${params}): ${(t.description || '').slice(0, 120)}`;
      });
      inventoryLines.push(`  ${server.name}:`);
      inventoryLines.push(...tools);

      if (server.compile_hints) {
        hintLines.push(`  **${server.name}**: ${server.compile_hints}`);
      }
    }
    return {
      inventory: inventoryLines.join('\n'),
      compileHints: hintLines.join('\n'),
    };
  } catch {
    return { inventory: '', compileHints: '' };
  }
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
  retryHint?: string,
): Promise<EnhancedCompilationPlan | null> {
  if (!hasLLMApiKey(LLM_MODEL_PRIMARY)) return null;

  const summaries = summarizeSteps(steps);
  const { inventory: toolInventory, compileHints } = await gatherServerToolInventory(steps);

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
    ``,
    ...(compileHints ? [
      `## Tool-Specific Compilation Hints`,
      `These hints come from the MCP server definitions and describe tool-specific constraints you MUST follow:`,
      compileHints,
      ``,
    ] : []),
    ...(toolInventory ? [
      `## Available Tools (full inventory from servers used in this execution)`,
      `Use these to substitute simpler tools for iterations when the executed tool is too complex.`,
      toolInventory,
    ] : []),
    ...(retryHint ? [retryHint] : []),
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

/** @deprecated Use EnhancedCompilationPlan from types.ts instead. */
export type CompilationPlan = EnhancedCompilationPlan;
