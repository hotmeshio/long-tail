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
  WORKFLOW_EXPIRE_SECS,
  YAML_LINE_WIDTH,
} from '../../../../modules/defaults';
import type { ActivityManifestEntry } from '../../../../types/yaml-workflow';
import { buildEnrichedInputSchema } from '../../input-analyzer';
import type { PipelineContext } from '../types';

import { capToolArguments, sanitizeName, inferSchema } from './utils';
import { deriveCategory, deriveTagsFromSteps } from './metadata';
import { wireStepInputs } from './wiring';
import { buildIterationActivities, findIterationSpec } from './iteration';
import { insertTransformActivities } from './transform';

// Re-export public utilities used by other modules
export { capToolArguments, sanitizeName } from './utils';

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

  // Build index remapping: collapsed step indices -> core step indices.
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

    // ── Iteration pattern: emit hook -> worker -> cycle -> done ──────────
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
    if (plan) {
      prevActivityId = insertTransformActivities(
        idx, plan, steps, prefix, graphTopic,
        triggerId, triggerInputKeys, stepIndexToActivityId,
        collapsedToCoreIndex, activities, transitions,
        activityManifest, prevActivityId,
      );
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
  const category = await deriveCategory(steps);

  ctx.yaml = yamlContent;
  ctx.inputSchema = inputSchema;
  ctx.outputSchema = outputSchema;
  ctx.activityManifest = activityManifest;
  ctx.tags = tags;
  ctx.category = category;

  return ctx;
}
