/**
 * DAG construction helpers for the build pipeline stage.
 *
 * Encapsulates the mutable state of DAG assembly (activities, transitions,
 * manifest) behind semantic operations so the main build() function reads
 * as a high-level pipeline.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import {
  LLM_MODEL_SECONDARY,
  WORKFLOW_EXPIRE_SECS,
  YAML_LINE_WIDTH,
} from '../../../../modules/defaults';
import type { ActivityManifestEntry } from '../../../../types/yaml-workflow';
import type {
  ExtractedStep,
  EnhancedCompilationPlan,
  IterationSpec,
} from '../../types';

import { capToolArguments, inferSchema } from './utils';
import { wireStepInputs } from './wiring';
import { buildIterationActivities } from './iteration';
import { insertTransformActivities } from './transform';

import type { DagBuilder } from '../../types';

// ── DAG lifecycle ────────────────────────────────────────────────────────────

/** Create the DAG with its trigger activity. */
export function initializeDag(
  prefix: string,
  graphTopic: string,
  inputSchema: Record<string, unknown>,
): DagBuilder {
  const triggerId = `${prefix}_t1`;
  const activities: Record<string, unknown> = {};
  const transitions: Record<string, Array<{ to: string }>> = {};

  activities[triggerId] = {
    title: 'Trigger',
    type: 'trigger',
    output: { schema: { type: 'object' } },
  };

  const manifest: ActivityManifestEntry[] = [{
    activity_id: triggerId,
    title: 'Trigger',
    type: 'trigger',
    tool_source: 'trigger',
    topic: graphTopic,
    input_mappings: {},
    output_fields: Object.keys(
      (inputSchema as { properties?: Record<string, unknown> }).properties || {},
    ),
  }];

  return {
    activities,
    transitions,
    manifest,
    stepIndexToActivityId: new Map(),
    prevActivityId: triggerId,
    prevResult: null,
    lastPivotId: null,
    triggerId,
  };
}

// ── Step appenders ───────────────────────────────────────────────────────────

/** Append an iteration pattern (hook → worker → cycle → done) to the DAG. */
export function appendIterationStep(
  dag: DagBuilder,
  iterSpec: IterationSpec,
  prefix: string,
  graphTopic: string,
  idx: number,
  step: ExtractedStep,
  triggerInputKeys: Set<string>,
  steps: ExtractedStep[],
  sessionFields: string[],
  plan: EnhancedCompilationPlan | null,
): void {
  const iterResult = buildIterationActivities(
    iterSpec, prefix, graphTopic, idx, step,
    dag.stepIndexToActivityId, dag.triggerId, triggerInputKeys,
    steps, sessionFields, plan,
  );

  Object.assign(dag.activities, iterResult.activities);
  Object.assign(dag.transitions, iterResult.transitions);
  dag.manifest.push(...iterResult.manifest);

  dag.transitions[dag.prevActivityId] = [{ to: iterResult.pivotId }];
  dag.prevActivityId = iterResult.doneId;
  dag.prevResult = step.result;
  dag.lastPivotId = iterResult.pivotId;
  dag.stepIndexToActivityId.set(idx, iterResult.pivotId);
}

/** Append a normal (non-iteration) step activity to the DAG. */
export function appendNormalStep(
  dag: DagBuilder,
  idx: number,
  step: ExtractedStep,
  prefix: string,
  graphTopic: string,
  plan: EnhancedCompilationPlan | null,
  steps: ExtractedStep[],
  triggerInputKeys: Set<string>,
  collapsedToCoreIndex: Map<number, number>,
): void {
  const actId = `${prefix}_a${idx + 1}`;
  dag.stepIndexToActivityId.set(idx, actId);
  dag.lastPivotId = null;

  const topicSuffix = step.kind === 'llm' ? 'interpret' : step.toolName;
  const topic = `${graphTopic}.${topicSuffix}`;
  const title = step.kind === 'llm'
    ? 'LLM Interpret'
    : step.toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Insert any transform (reshape) activities before this step
  if (plan) {
    dag.prevActivityId = insertTransformActivities(
      idx, plan, steps, prefix, graphTopic,
      dag.triggerId, triggerInputKeys, dag.stepIndexToActivityId,
      collapsedToCoreIndex, dag.activities, dag.transitions,
      dag.manifest, dag.prevActivityId,
    );
  }

  // Wire input mappings from upstream steps
  const inputMappings = wireStepInputs(
    idx, step, plan, dag.stepIndexToActivityId,
    dag.triggerId, triggerInputKeys, steps, prefix,
    dag.prevActivityId, dag.prevResult, collapsedToCoreIndex,
  );

  // Build the activity definition
  const resultSchema = step.result ? inferSchema(step.result) : { type: 'object' };
  const outputFields = extractOutputFields(step);
  const jobMaps = buildJobMaps(idx, steps.length, outputFields);

  dag.activities[actId] = {
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

  // Build manifest entry
  dag.manifest.push(buildManifestEntry(actId, title, step, topic, inputMappings, outputFields));

  // Transition from previous step
  dag.transitions[dag.prevActivityId] = [{ to: actId }];
  dag.prevActivityId = actId;
  dag.prevResult = step.result;
}

// ── Serialization ────────────────────────────────────────────────────────────

/** Assemble the DAG into a HotMesh YAML document. */
export function serializeToYaml(
  appId: string,
  graphTopic: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
  dag: DagBuilder,
): string {
  const graphDef = {
    app: {
      id: appId,
      version: '1',
      graphs: [{
        subscribes: graphTopic,
        expire: WORKFLOW_EXPIRE_SECS,
        input: { schema: inputSchema },
        output: { schema: outputSchema },
        activities: dag.activities,
        transitions: dag.transitions,
      }],
    },
  };

  return yaml.dump(graphDef, {
    lineWidth: YAML_LINE_WIDTH,
    noRefs: true,
    sortKeys: false,
  });
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function extractOutputFields(step: ExtractedStep): string[] {
  if (step.result && typeof step.result === 'object' && !Array.isArray(step.result)) {
    return Object.keys(step.result as Record<string, unknown>);
  }
  return [];
}

function buildJobMaps(
  stepIdx: number,
  totalSteps: number,
  outputFields: string[],
): Record<string, string> | undefined {
  if (stepIdx !== totalSteps - 1 || outputFields.length === 0) return undefined;
  return outputFields.reduce((acc, field) => {
    acc[field] = `{$self.output.data.${field}}`;
    return acc;
  }, {} as Record<string, string>);
}

function buildManifestEntry(
  actId: string,
  title: string,
  step: ExtractedStep,
  topic: string,
  inputMappings: Record<string, string>,
  outputFields: string[],
): ActivityManifestEntry {
  const promptTemplate = step.kind === 'llm' && step.promptMessages
    ? step.promptMessages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')
    : undefined;

  return {
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
  };
}
