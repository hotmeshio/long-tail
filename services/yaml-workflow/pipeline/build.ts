/**
 * Build stage: construct the HotMesh YAML DAG from the compilation plan.
 *
 * When an EnhancedCompilationPlan is available, uses its iteration specs,
 * data flow edges, and key mappings to build a faithful deterministic DAG.
 * Falls back to mechanical heuristics when no plan is available.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import {
  LLM_MODEL_SECONDARY,
  TOOL_ARG_LIMIT_CAP,
  WORKFLOW_EXPIRE_SECS,
  YAML_LINE_WIDTH,
} from '../../../modules/defaults';
import type { ActivityManifestEntry, InputFieldMeta } from '../../../types/yaml-workflow';
import { buildEnrichedInputSchema } from '../input-analyzer';
import type {
  ExtractedStep,
  EnhancedCompilationPlan,
  IterationSpec,
  DataFlowEdge,
  PipelineContext,
} from './types';

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Check if two keys are semantically related (for computed key fallback).
 * Replicates the logic from pattern-detector but local to the build stage.
 */
function keysRelated(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la.includes(lb) || lb.includes(la)) return true;
  const urlKeys = ['url', 'href', 'link', 'src'];
  if (urlKeys.includes(la) && urlKeys.includes(lb)) return true;
  const pathKeys = ['path', 'file', 'filepath', 'filename', 'name'];
  if (pathKeys.some(p => la.includes(p)) && pathKeys.some(p => lb.includes(p))) return true;
  return false;
}

/** Cap `limit` in tool arguments to avoid sending huge payloads to downstream LLM steps. */
export function capToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const capped = { ...args };
  if (typeof capped.limit === 'number' && capped.limit > TOOL_ARG_LIMIT_CAP) {
    capped.limit = TOOL_ARG_LIMIT_CAP;
  }
  return capped;
}

/** Sanitize a name for use in HotMesh app IDs and topics. */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Convert a snake_case/camelCase field name to a readable label. */
function humanize(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Infer a JSON Schema from a sample value, recursively.
 */
function inferSchema(value: unknown, withDefault = false): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { type: 'string' };
  }

  if (typeof value === 'string') {
    const schema: Record<string, unknown> = { type: 'string' };
    if (withDefault) schema.default = value;
    return schema;
  }

  if (typeof value === 'number') {
    const schema: Record<string, unknown> = { type: 'number' };
    if (withDefault) schema.default = value;
    return schema;
  }

  if (typeof value === 'boolean') {
    const schema: Record<string, unknown> = { type: 'boolean' };
    if (withDefault) schema.default = value;
    return schema;
  }

  if (Array.isArray(value)) {
    const schema: Record<string, unknown> = { type: 'array' };
    if (withDefault) schema.default = value;

    if (value.length > 0) {
      if (value.every((v) => typeof v === 'string')) {
        schema.items = { type: 'string' };
      } else if (value.every((v) => typeof v === 'number')) {
        schema.items = { type: 'number' };
      } else if (value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
        const allKeys = new Map<string, unknown>();
        for (const el of value) {
          for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
            if (!allKeys.has(k)) allKeys.set(k, v);
          }
        }
        const props: Record<string, unknown> = {};
        for (const [k, v] of allKeys) {
          props[k] = inferSchema(v, false);
          (props[k] as Record<string, unknown>).description = humanize(k);
        }
        schema.items = { type: 'object', properties: props };
      }
    }
    return schema;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const props: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      props[k] = inferSchema(v, withDefault);
      (props[k] as Record<string, unknown>).description = humanize(k);
    }
    return { type: 'object', properties: props };
  }

  return { type: 'string' };
}

/**
 * Build data mappings from a previous activity's output fields.
 */
function buildInputMappings(
  prevActivityId: string,
  prevResult: unknown,
): Record<string, string> {
  const mappings: Record<string, string> = {};
  if (prevResult && typeof prevResult === 'object' && !Array.isArray(prevResult)) {
    for (const key of Object.keys(prevResult as Record<string, unknown>)) {
      mappings[key] = `{${prevActivityId}.output.data.${key}}`;
    }
  }
  return mappings;
}

// ── Category and tag derivation ───────────────────────────────────────────────

const CATEGORY_SIGNALS: Array<{ category: string; keywords: string[] }> = [
  { category: 'browser-automation', keywords: ['playwright', 'browser', 'navigate', 'screenshot', 'capture', 'click', 'login', 'page', 'puppeteer', 'selenium'] },
  { category: 'document-processing', keywords: ['vision', 'document', 'ocr', 'extract', 'pdf', 'scan', 'parse'] },
  { category: 'data-extraction', keywords: ['query', 'sql', 'database', 'db', 'select', 'find_tasks', 'search'] },
  { category: 'api-integration', keywords: ['http', 'fetch', 'api', 'request', 'webhook', 'rest', 'graphql'] },
  { category: 'file-management', keywords: ['file', 'storage', 'upload', 'download', 'write_file', 'read_file', 'list_files'] },
  { category: 'escalation', keywords: ['escalat', 'human', 'queue', 'approval', 'review'] },
  { category: 'workflow-orchestration', keywords: ['workflow', 'compiler', 'orchestrat', 'deploy', 'yaml'] },
];

function deriveCategory(steps: ExtractedStep[]): string {
  const counts = new Map<string, number>();
  const tokens: string[] = [];
  for (const step of steps) {
    if (step.kind === 'tool') {
      tokens.push(step.toolName.toLowerCase());
      if (step.mcpServerId) tokens.push(step.mcpServerId.toLowerCase());
      for (const key of Object.keys(step.arguments)) {
        tokens.push(key.toLowerCase());
      }
    }
  }
  const signalText = tokens.join(' ');

  for (const { category, keywords } of CATEGORY_SIGNALS) {
    const hits = keywords.filter(kw => signalText.includes(kw)).length;
    if (hits > 0) counts.set(category, (counts.get(category) || 0) + hits);
  }

  const hasLlm = steps.some(s => s.kind === 'llm');
  if (hasLlm && (counts.get('data-extraction') || 0) > 0) {
    counts.set('reporting', (counts.get('reporting') || 0) + 5);
  }

  let best = 'general';
  let bestCount = 0;
  for (const [cat, count] of counts) {
    if (count > bestCount) { best = cat; bestCount = count; }
  }
  return best;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was',
  'not', 'but', 'has', 'have', 'had', 'been', 'will', 'can', 'all',
]);

function deriveTagsFromSteps(
  steps: ExtractedStep[],
  name: string,
  description?: string,
): string[] {
  const tags = new Set<string>();

  for (const step of steps) {
    if (step.kind === 'tool') {
      tags.add(step.toolName);
      if (step.mcpServerId) tags.add(step.mcpServerId);
      tags.add(step.source);
    }
  }

  const text = `${name} ${description || ''}`.toLowerCase();
  const keywords = text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  for (const kw of keywords) {
    tags.add(kw);
  }

  return Array.from(tags);
}

// ── Plan-driven builders ──────────────────────────────────────────────────────

/**
 * Build input mappings for a step using the compilation plan's data flow edges.
 * Falls back to mechanical backward-scan when no plan is available.
 */
function wireStepInputs(
  stepIdx: number,
  step: ExtractedStep,
  plan: EnhancedCompilationPlan | null,
  stepIndexToActivityId: Map<number, string>,
  triggerId: string,
  triggerInputKeys: Set<string>,
  steps: ExtractedStep[],
  prefix: string,
  prevActivityId: string,
  prevResult: unknown,
  collapsedToCoreIndex?: Map<number, number>,
): Record<string, string> {
  const inputMappings: Record<string, string> = {};

  // Plan-driven wiring: use data flow edges from the compilation plan.
  // Remap indices from collapsed-step space to core-step space.
  if (plan && plan.dataFlow.length > 0) {
    // Remap the current step index back to collapsed space for edge matching
    const collapsedIdx = collapsedToCoreIndex?.size
      ? [...collapsedToCoreIndex.entries()].find(([_, core]) => core === stepIdx)?.[0] ?? stepIdx
      : stepIdx;
    const edgesForStep = plan.dataFlow.filter(e => e.toStep === collapsedIdx);
    for (const edge of edgesForStep) {
      if (edge.transform && Object.keys(edge.transform.fieldMap).length > 0) {
        // This edge has a transform — the reshape activity was inserted before this step.
        // Wire from the transform activity's output (which uses toField as the output key).
        const transformActId = `${prefix}_xf${stepIdx + 1}`;
        inputMappings[edge.toField] = `{${transformActId}.output.data.${edge.toField}}`;
      } else if (edge.fromStep === 'trigger') {
        inputMappings[edge.toField] = `{${triggerId}.output.data.${edge.fromField}}`;
      } else {
        // Remap the source step from collapsed to core index
        const remappedFrom = collapsedToCoreIndex?.get(edge.fromStep as number) ?? edge.fromStep;
        const sourceActId = stepIndexToActivityId.get(remappedFrom as number);
        if (sourceActId) {
          inputMappings[edge.toField] = `{${sourceActId}.output.data.${edge.fromField}}`;
        }
      }
    }
    // If the plan provided wiring for this step, use it
    if (edgesForStep.length > 0) return inputMappings;
  }

  // Mechanical fallback: match step argument keys against trigger inputs and prior outputs.
  // Skip complex array/object arguments — they come from stored tool_arguments, not wiring.
  if (step.kind === 'tool') {
    for (const key of Object.keys(step.arguments)) {
      if (key === '_iteration') continue;
      // Don't wire complex arguments (arrays, nested objects) — these are stored defaults
      const argValue = step.arguments[key];
      if (Array.isArray(argValue) || (argValue && typeof argValue === 'object' && !Array.isArray(argValue) && Object.keys(argValue as object).length > 2)) {
        continue;
      }
      if (triggerInputKeys.has(key)) {
        inputMappings[key] = `{${triggerId}.output.data.${key}}`;
      } else if (prevResult && typeof prevResult === 'object' && !Array.isArray(prevResult) &&
                 key in (prevResult as Record<string, unknown>)) {
        inputMappings[key] = `{${prevActivityId}.output.data.${key}}`;
      } else {
        // Walk backward to find any upstream step that produced this field
        for (let si = stepIdx - 1; si >= 0; si--) {
          const priorResult = steps[si].result;
          if (priorResult && typeof priorResult === 'object' && !Array.isArray(priorResult) &&
              key in (priorResult as Record<string, unknown>)) {
            const priorActId = stepIndexToActivityId.get(si) || `${prefix}_a${si + 1}`;
            inputMappings[key] = `{${priorActId}.output.data.${key}}`;
            break;
          }
        }
      }
    }
  } else {
    // LLM steps: wire all previous output fields
    if (prevResult && typeof prevResult === 'object' && !Array.isArray(prevResult)) {
      for (const key of Object.keys(prevResult as Record<string, unknown>)) {
        inputMappings[key] = `{${prevActivityId}.output.data.${key}}`;
      }
    }
  }

  return inputMappings;
}

/**
 * Build iteration activities (hook → worker → cycle → done) from an IterationSpec.
 *
 * When key mappings are available (from the compilation plan), uses the mapped
 * key names in the @pipe transforms so array item keys correctly map to tool args.
 */
function buildIterationActivities(
  spec: IterationSpec,
  prefix: string,
  graphTopic: string,
  idx: number,
  step: ExtractedStep,
  stepIndexToActivityId: Map<number, string>,
  triggerId: string,
  triggerInputKeys: Set<string>,
  steps: ExtractedStep[],
  sessionFields: string[],
  plan: EnhancedCompilationPlan | null,
): {
  activities: Record<string, unknown>;
  transitions: Record<string, Array<{ to: string; conditions?: Record<string, unknown> }>>;
  manifest: ActivityManifestEntry[];
  pivotId: string;
  doneId: string;
} {
  const pivotId = `${prefix}_pivot${idx + 1}`;
  const workerId = `${prefix}_iter${idx + 1}`;
  const cycleId = `${prefix}_cycle${idx + 1}`;
  const doneId = `${prefix}_done${idx + 1}`;
  const originalTool = spec.toolName;
  const workerTopic = `${graphTopic}.${originalTool}`;

  // Determine the array source reference
  const sourceActId = stepIndexToActivityId.get(spec.sourceStepIndex);
  const arraySourceRef = sourceActId
    ? `{${sourceActId}.output.data.${spec.sourceField}}`
    : `{${prefix}_a${spec.sourceStepIndex + 1}.output.data.${spec.sourceField}}`;

  // Hook (cycle anchor): initializes index and holds the items array
  const activities: Record<string, unknown> = {};
  activities[pivotId] = {
    title: `Iterate ${humanize(originalTool)}`,
    type: 'hook',
    cycle: true,
    output: {
      maps: {
        index: 0,
        items: arraySourceRef,
      },
    },
  };

  // Worker: maps varying keys from the current array item
  const workerInputMaps: Record<string, unknown> = {};
  for (const key of spec.varyingKeys) {
    // Use key mapping if available: tool wants 'url' but array items have 'href'
    const arrayItemKey = spec.keyMappings[key];
    if (arrayItemKey === null) {
      // Computed/generated key — not directly from the array.
      // 1. Check if the trigger provides it
      if (triggerInputKeys.has(key)) {
        workerInputMaps[key] = `{${triggerId}.output.data.${key}}`;
        continue;
      }
      // 2. Try to find a semantically related field in the array items
      //    e.g., tool wants 'path' → array items have 'name' (path contains name)
      const sourceActId = stepIndexToActivityId.get(spec.sourceStepIndex);
      if (sourceActId) {
        const sourceStep = steps.find((_, si) => stepIndexToActivityId.get(si) === sourceActId);
        if (sourceStep?.result && typeof sourceStep.result === 'object') {
          const resultObj = sourceStep.result as Record<string, unknown>;
          const arrayField = spec.sourceField.split('.').reduce(
            (obj: any, k: string) => obj?.[k], resultObj,
          );
          if (Array.isArray(arrayField) && arrayField.length > 0 && typeof arrayField[0] === 'object') {
            const itemKeys = Object.keys(arrayField[0] as Record<string, unknown>);
            const match = itemKeys.find(ik => keysRelated(key, ik));
            if (match) {
              workerInputMaps[key] = {
                '@pipe': [
                  [`{${pivotId}.output.data.items}`, `{${pivotId}.output.data.index}`],
                  ['{@array.get}'],
                  [`{@object.get}`, match],
                ],
              };
              continue;
            }
          }
        }
      }
      continue;
    }
    const lookupKey = arrayItemKey || key;
    workerInputMaps[key] = {
      '@pipe': [
        [`{${pivotId}.output.data.items}`, `{${pivotId}.output.data.index}`],
        ['{@array.get}'],
        [`{@object.get}`, lookupKey],
      ],
    };
  }

  // Wire constant args from trigger or directly
  for (const [key, value] of Object.entries(spec.constantArgs)) {
    if (key === '_iteration') continue;
    if (triggerInputKeys.has(key)) {
      workerInputMaps[key] = `{${triggerId}.output.data.${key}}`;
    } else {
      workerInputMaps[key] = value;
    }
  }

  // Wire session fields — plan-driven first, then mechanical backward scan
  for (const wiredKey of sessionFields) {
    if (workerInputMaps[wiredKey]) continue; // already mapped

    // Plan-driven: use data flow edges for session wiring
    if (plan && plan.dataFlow.length > 0) {
      const edge = plan.dataFlow.find(e =>
        e.toStep === spec.bodyStepIndex && e.toField === wiredKey && e.isSessionWire,
      );
      if (edge && edge.fromStep !== 'trigger') {
        const sourceActId = stepIndexToActivityId.get(edge.fromStep as number);
        if (sourceActId) {
          workerInputMaps[wiredKey] = `{${sourceActId}.output.data.${wiredKey}}`;
          continue;
        }
      }
    }

    // Mechanical fallback: walk backward to find upstream producer
    for (let si = idx - 1; si >= 0; si--) {
      const priorResult = steps[si].result;
      if (priorResult && typeof priorResult === 'object' && !Array.isArray(priorResult) &&
          wiredKey in (priorResult as Record<string, unknown>)) {
        const priorActId = stepIndexToActivityId.get(si) || `${prefix}_a${si + 1}`;
        workerInputMaps[wiredKey] = `{${priorActId}.output.data.${wiredKey}}`;
        break;
      }
    }
  }

  const resultSchema = step.result ? inferSchema(step.result) : { type: 'object' };

  activities[workerId] = {
    title: humanize(originalTool),
    type: 'worker',
    topic: workerTopic,
    input: {
      schema: { type: 'object' },
      maps: workerInputMaps,
    },
    output: { schema: resultSchema },
  };

  // Cycle: increment index and loop back to pivot
  activities[cycleId] = {
    title: 'Next Item',
    type: 'cycle',
    ancestor: pivotId,
    input: {
      maps: {
        index: {
          '@pipe': [
            [`{${pivotId}.output.data.index}`, 1],
            ['{@math.add}'],
          ],
        },
      },
    },
  };

  // Done: exit hook after iteration completes
  activities[doneId] = {
    title: 'Iteration Complete',
    type: 'hook',
  };

  // Transitions
  const transitions: Record<string, Array<{ to: string; conditions?: Record<string, unknown> }>> = {};
  transitions[pivotId] = [{ to: workerId }];
  transitions[workerId] = [
    {
      to: cycleId,
      conditions: {
        match: [{
          expected: true,
          actual: {
            '@pipe': [
              [`{${pivotId}.output.data.index}`, 1],
              ['{@math.add}'],
              [`{${pivotId}.output.data.items}`, '{@array.length}'],
              ['{@conditional.less_than}'],
            ],
          },
        }],
      },
    },
    { to: doneId },
  ];

  // Manifest entries
  const manifest: ActivityManifestEntry[] = [
    { activity_id: pivotId, title: `Iterate ${humanize(originalTool)}`, type: 'worker' as const, tool_source: 'trigger', topic: graphTopic, input_mappings: {}, output_fields: ['index', 'items'] },
    { activity_id: workerId, title: humanize(originalTool), type: 'worker' as const, tool_source: step.source, topic: workerTopic, mcp_server_id: spec.serverId, mcp_tool_name: originalTool, input_mappings: workerInputMaps as Record<string, string>, output_fields: [] },
    { activity_id: cycleId, title: 'Next Item', type: 'worker' as const, tool_source: 'trigger', topic: graphTopic, input_mappings: {}, output_fields: [] },
    { activity_id: doneId, title: 'Iteration Complete', type: 'worker' as const, tool_source: 'trigger', topic: graphTopic, input_mappings: {}, output_fields: [] },
  ];

  return { activities, transitions, manifest, pivotId, doneId };
}

/**
 * Check if a step should be rendered as an iteration based on the compilation plan.
 */
function findIterationSpec(
  stepIdx: number,
  plan: EnhancedCompilationPlan | null,
  step: ExtractedStep,
  collapsedToCoreIndex?: Map<number, number>,
): IterationSpec | null {
  // Plan-driven: check if the plan specifies an iteration for this step.
  // The plan uses collapsed-step indices; remap to core-step indices.
  if (plan) {
    const spec = plan.iterations.find(it => {
      const remappedBody = collapsedToCoreIndex?.get(it.bodyStepIndex) ?? it.bodyStepIndex;
      return remappedBody === stepIdx;
    });
    if (spec) {
      // Remap sourceStepIndex from collapsed to core space
      const remappedSource = collapsedToCoreIndex?.get(spec.sourceStepIndex) ?? spec.sourceStepIndex;
      return { ...spec, bodyStepIndex: stepIdx, sourceStepIndex: remappedSource };
    }
  }

  // Mechanical fallback: check _iteration metadata from pattern detector
  const iteration = step.arguments?._iteration as {
    tool: string; server: string; items: Array<Record<string, unknown>>;
    varyingKeys: string[]; constantArgs: Record<string, unknown>;
    arraySource: { stepIndex: number; field: string } | null; count: number;
  } | undefined;

  if (iteration) {
    return {
      bodyStepIndex: stepIdx,
      toolName: iteration.tool.replace(/_batch$/, ''),
      serverId: iteration.server,
      sourceStepIndex: iteration.arraySource?.stepIndex ?? stepIdx - 1,
      sourceField: iteration.arraySource?.field ?? 'items',
      varyingKeys: iteration.varyingKeys,
      constantArgs: iteration.constantArgs,
      keyMappings: {}, // no key mappings from mechanical detection
    };
  }

  return null;
}

// ── Build stage ───────────────────────────────────────────────────────────────

/**
 * Build pipeline stage: construct the HotMesh YAML DAG.
 */
export async function build(ctx: PipelineContext): Promise<PipelineContext> {
  const { options, coreSteps: steps, refinedInputs, compilationPlan: plan } = ctx;
  const { appId, subscribes: graphTopic, name, description } = options;

  const inputSchema = buildEnrichedInputSchema(refinedInputs);
  const triggerInputKeys = new Set(refinedInputs.map(f => f.key));

  // Determine session fields from plan or use defaults
  const sessionFields = plan?.sessionFields?.length
    ? plan.sessionFields
    : ['page_id', '_handle', 'session_id'];

  // Build index remapping: collapsed step indices → core step indices.
  // The compilation plan uses indices from collapsedSteps, but after core
  // step filtering, those indices shift. This map lets us translate.
  const collapsedToCoreIndex = new Map<number, number>();
  if (plan && plan.coreStepIndices.length > 0 && plan.coreStepIndices.length < ctx.collapsedSteps.length) {
    plan.coreStepIndices.forEach((collapsedIdx, coreIdx) => {
      collapsedToCoreIndex.set(collapsedIdx, coreIdx);
    });
  }

  // Infer output schema from the last step's result
  const lastStep = steps[steps.length - 1];
  const outputSchema = lastStep?.result
    ? inferSchema(lastStep.result)
    : { type: 'object' as const };

  // Build activities and transitions
  // HotMesh has a max activity ID length — keep prefix short (max 20 chars)
  const rawPrefix = graphTopic.replace(/[^a-z0-9]/g, '_');
  const prefix = rawPrefix.length > 20 ? rawPrefix.slice(0, 20) : rawPrefix;
  const activities: Record<string, unknown> = {};
  const transitions: Record<string, Array<{ to: string; conditions?: Record<string, unknown> }>> = {};
  const activityManifest: ActivityManifestEntry[] = [];

  // Trigger activity
  const triggerId = `${prefix}_t1`;
  activities[triggerId] = {
    title: 'Trigger',
    type: 'trigger',
    output: { schema: { type: 'object' } },
  };
  activityManifest.push({
    activity_id: triggerId,
    title: 'Trigger',
    type: 'trigger',
    tool_source: 'trigger',
    topic: graphTopic,
    input_mappings: {},
    output_fields: Object.keys(
      (inputSchema as { properties?: Record<string, unknown> }).properties || {},
    ),
  });

  let prevActivityId = triggerId;
  let prevResult: unknown = null;

  const stepIndexToActivityId = new Map<number, string>();
  let lastPivotId: string | null = null;

  steps.forEach((step, idx) => {
    // Check for iteration (plan-driven or mechanical fallback)
    const iterSpec = findIterationSpec(idx, plan, step, collapsedToCoreIndex);

    // ── Iteration pattern: emit hook → worker → cycle → done ──────────
    if (iterSpec) {
      const iterResult = buildIterationActivities(
        iterSpec,
        prefix,
        graphTopic,
        idx,
        step,
        stepIndexToActivityId,
        triggerId,
        triggerInputKeys,
        steps,
        sessionFields,
        plan,
      );

      Object.assign(activities, iterResult.activities);
      Object.assign(transitions, iterResult.transitions);
      activityManifest.push(...iterResult.manifest);

      // Transition from previous to pivot
      transitions[prevActivityId] = [{ to: iterResult.pivotId }];

      prevActivityId = iterResult.doneId;
      prevResult = step.result;
      lastPivotId = iterResult.pivotId;
      stepIndexToActivityId.set(idx, iterResult.pivotId);
      return;
    }

    // ── Normal step ───────────────────────────────────────────────────
    const actId = `${prefix}_a${idx + 1}`;
    stepIndexToActivityId.set(idx, actId);
    lastPivotId = null;
    const topicSuffix = step.kind === 'llm' ? 'interpret' : step.toolName;
    const topic = `${graphTopic}.${topicSuffix}`;
    const title = step.kind === 'llm'
      ? 'LLM Interpret'
      : step.toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // ── Check for transform edges targeting this step ──
    // If a data flow edge has a transform, insert a reshape activity before this step.
    if (plan) {
      const collapsedIdx = collapsedToCoreIndex?.size
        ? [...collapsedToCoreIndex.entries()].find(([_, core]) => core === idx)?.[0] ?? idx
        : idx;
      const transformEdges = plan.dataFlow.filter(
        e => e.toStep === collapsedIdx && e.transform && Object.keys(e.transform.fieldMap).length > 0,
      );

      for (const edge of transformEdges) {
        const transformId = `${prefix}_xf${idx + 1}`;
        const transformTopic = `${graphTopic}.reshape_${edge.toField}`;

        // Wire transform input: source field from prior step + all trigger inputs
        // (trigger inputs needed for dynamic derivation prefixes like screenshot_dir)
        const transformInputMaps: Record<string, string> = {};
        for (const triggerKey of triggerInputKeys) {
          transformInputMaps[triggerKey] = `{${triggerId}.output.data.${triggerKey}}`;
        }
        if (edge.fromStep === 'trigger') {
          transformInputMaps[edge.fromField] = `{${triggerId}.output.data.${edge.fromField}}`;
        } else {
          const remappedFrom = collapsedToCoreIndex?.get(edge.fromStep as number) ?? edge.fromStep;
          const sourceActId = stepIndexToActivityId.get(remappedFrom as number);
          if (sourceActId) {
            transformInputMaps[edge.fromField] = `{${sourceActId}.output.data.${edge.fromField}}`;
          }
        }

        activities[transformId] = {
          title: `Reshape ${humanize(edge.toField)}`,
          type: 'worker',
          topic: transformTopic,
          input: {
            schema: { type: 'object' },
            maps: transformInputMaps,
          },
          output: { schema: { type: 'object' } },
        };

        activityManifest.push({
          activity_id: transformId,
          title: `Reshape ${humanize(edge.toField)}`,
          type: 'worker',
          tool_source: 'transform',
          topic: transformTopic,
          input_mappings: transformInputMaps,
          output_fields: [edge.toField],
          transform_spec: {
            sourceField: edge.fromField,
            targetField: edge.toField,
            fieldMap: edge.transform!.fieldMap,
            defaults: edge.transform!.defaults,
            derivations: edge.transform!.derivations,
          },
        });

        // Transition from previous → transform
        transitions[prevActivityId] = [{ to: transformId }];
        prevActivityId = transformId;
      }
    }

    // Build input maps
    const inputMappings = wireStepInputs(
      idx, step, plan, stepIndexToActivityId,
      triggerId, triggerInputKeys, steps, prefix,
      prevActivityId, prevResult, collapsedToCoreIndex,
    );

    const resultSchema = step.result ? inferSchema(step.result) : { type: 'object' };
    const outputFields = step.result && typeof step.result === 'object' && !Array.isArray(step.result)
      ? Object.keys(step.result as Record<string, unknown>)
      : [];

    // Build job maps for the last activity
    const isLastActivity = idx === steps.length - 1;
    const jobMaps: Record<string, string> | undefined = isLastActivity && outputFields.length > 0
      ? outputFields.reduce((acc, field) => {
          acc[field] = `{$self.output.data.${field}}`;
          return acc;
        }, {} as Record<string, string>)
      : undefined;

    activities[actId] = {
      title,
      type: 'worker',
      topic,
      input: {
        schema: { type: 'object' },
        ...(Object.keys(inputMappings).length > 0 ? { maps: inputMappings } : {}),
      },
      output: { schema: resultSchema },
      ...(jobMaps ? { job: { maps: jobMaps } } : {}),
    };

    // Build prompt template for LLM steps
    const promptTemplate = step.kind === 'llm' && step.promptMessages
      ? step.promptMessages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')
      : undefined;

    activityManifest.push({
      activity_id: actId,
      title,
      type: 'worker',
      tool_source: step.source,
      topic,
      ...(step.kind === 'tool' ? {
        mcp_server_id: step.source === 'mcp' ? step.mcpServerId : 'db',
        mcp_tool_name: step.toolName,
        tool_arguments: Object.keys(step.arguments).length > 0
          ? capToolArguments(step.arguments) : undefined,
      } : {}),
      input_mappings: inputMappings,
      output_fields: outputFields,
      ...(promptTemplate ? { prompt_template: promptTemplate } : {}),
      ...(step.kind === 'llm' ? { model: LLM_MODEL_SECONDARY } : {}),
    });

    // Transition from previous
    transitions[prevActivityId] = [{ to: actId }];

    prevActivityId = actId;
    prevResult = step.result;
  });

  // Build the full YAML graph structure
  const graphDef = {
    app: {
      id: appId,
      version: '1',
      graphs: [
        {
          subscribes: graphTopic,
          expire: WORKFLOW_EXPIRE_SECS,
          input: { schema: inputSchema },
          output: { schema: outputSchema },
          activities,
          transitions,
        },
      ],
    },
  };

  const yamlContent = yaml.dump(graphDef, {
    lineWidth: YAML_LINE_WIDTH,
    noRefs: true,
    sortKeys: false,
  });

  // Auto-generate tags and category
  const tags = deriveTagsFromSteps(steps, name, description);
  const category = deriveCategory(steps);

  ctx.yaml = yamlContent;
  ctx.inputSchema = inputSchema;
  ctx.outputSchema = outputSchema;
  ctx.activityManifest = activityManifest;
  ctx.tags = tags;
  ctx.category = category;

  return ctx;
}
