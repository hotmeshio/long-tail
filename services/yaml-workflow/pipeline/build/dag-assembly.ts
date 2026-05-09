/**
 * DAG step-appender functions for building iteration, normal, and signal
 * activities. Extracted from dag.ts to keep each file under 300 lines.
 */

import type { ActivityManifestEntry } from '../../../../types/yaml-workflow';
import type {
  ExtractedStep,
  EnhancedCompilationPlan,
  IterationSpec,
  DagBuilder,
} from '../../types';

import { capToolArguments, inferSchema } from './utils';
import { wireStepInputs } from './wiring';
import { buildIterationActivities } from './iteration';
import { insertTransformActivities } from './transform';
import {
  LLM_MODEL_SECONDARY,
} from '../../../../modules/defaults';

// ── Step appenders ───────────────────────────────────────────────────────────

/** Append an iteration pattern (hook -> worker -> cycle -> done) to the DAG. */
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

  const workflowName = step.kind === 'llm' ? 'interpret' : step.toolName;
  const topic = graphTopic;
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

  // Wire input mappings from upstream steps (may include @pipe objects for derivations)
  const inputMappings: Record<string, unknown> = wireStepInputs(
    idx, step, plan, dag.stepIndexToActivityId,
    dag.triggerId, triggerInputKeys, steps, prefix,
    dag.prevActivityId, dag.prevResult, collapsedToCoreIndex,
  );

  // Build the activity definition
  const resultSchema = step.result ? inferSchema(step.result) : { type: 'object' };
  const outputFields = extractOutputFields(step);
  const jobMaps = buildJobMaps(idx, steps.length, outputFields);

  // Thread _scope from trigger through every activity for IAM context
  inputMappings._scope = `{${dag.triggerId}.output.data._scope}`;
  // Set workflowName for singleton consumer dispatch routing
  inputMappings.workflowName = workflowName;

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
  dag.manifest.push(buildManifestEntry(actId, title, step, topic, workflowName, inputMappings, outputFields));

  // Transition from previous step
  dag.transitions[dag.prevActivityId] = [{ to: actId }];
  dag.prevActivityId = actId;
  dag.prevResult = step.result;
}

/**
 * Append a signal step pair (escalation worker + hook) to the DAG.
 *
 * The escalation worker creates the escalation via the human-queue MCP tool.
 * The hook pauses until the escalation is resolved and a signal arrives.
 * A hooks section entry routes the external signal to the waiting hook.
 */
export function appendSignalStep(
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
  // The step before this signal step is the escalation tool call.
  // The signal step itself represents the pause/resume point.
  const hookId = `${prefix}_wait${idx + 1}`;
  dag.stepIndexToActivityId.set(idx, hookId);
  dag.lastPivotId = null;

  const signalSchema = step.signalSchema || { type: 'object', properties: {} };
  const outputFields = signalSchema.properties
    ? Object.keys(signalSchema.properties as Record<string, unknown>)
    : [];

  // Build job maps: map each signal field from hook data to job state
  const jobMaps: Record<string, string> = {};
  for (const field of outputFields) {
    jobMaps[field] = `{$self.hook.data.${field}}`;
  }

  // Hook topic: scoped per graph, per activity for multiple hooks
  const hookTopic = `escalation.resolved.${graphTopic}.${hookId}`;

  // The hook activity -- pauses until signal arrives
  dag.activities[hookId] = {
    title: 'Wait for Human Input',
    type: 'hook',
    hook: signalSchema,
    output: {
      schema: signalSchema,
    },
    ...(Object.keys(jobMaps).length > 0 ? { job: { maps: jobMaps } } : {}),
  };

  // Find the escalation worker that precedes this signal step.
  // It's the previous activity in the DAG -- its output.data.escalationId
  // is used as the match condition for routing signals.
  const escalationActId = dag.prevActivityId;

  // Patch the preceding escalation worker to persist escalationId to the job hash.
  // Without job.maps, the hook's match condition can't resolve {a1.output.data.escalationId}.
  const prevActivity = dag.activities[escalationActId] as Record<string, any>;
  if (prevActivity && prevActivity.type === 'worker') {
    prevActivity.job = {
      ...(prevActivity.job || {}),
      maps: {
        ...(prevActivity.job?.maps || {}),
        escalationId: '{$self.output.data.escalationId}',
        signalId: '{$self.output.data.signalId}',
      },
    };
  }

  // Hook rules: route signals to this hook with job ID match.
  // Use {$job.metadata.jid} (always available) as the match key.
  // The signal must include the job_id in its payload for routing.
  dag.hooks[hookTopic] = [{
    to: hookId,
    conditions: {
      match: [{
        expected: '{$job.metadata.jid}',
        actual: '{$self.hook.data.job_id}',
      }],
    },
  }];

  // Manifest entry
  dag.manifest.push({
    activity_id: hookId,
    title: 'Wait for Human Input',
    type: 'hook',
    tool_source: 'signal',
    topic: graphTopic,
    hook_topic: hookTopic,
    signal_schema: signalSchema,
    input_mappings: {},
    output_fields: outputFields,
  });

  // Transition from previous step (the escalation worker) to the hook
  dag.transitions[dag.prevActivityId] = [{ to: hookId }];
  dag.prevActivityId = hookId;
  dag.prevResult = step.result;
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
  if (stepIdx !== totalSteps - 1) return undefined;
  if (outputFields.length > 0) {
    return outputFields.reduce((acc, field) => {
      acc[field] = `{$self.output.data.${field}}`;
      return acc;
    }, {} as Record<string, string>);
  }
  // Final step with no structured output fields (e.g., string result) --
  // persist the raw response so the workflow result isn't null
  return { response: '{$self.output.data.response}' };
}

function buildManifestEntry(
  actId: string,
  title: string,
  step: ExtractedStep,
  topic: string,
  workflowName: string,
  inputMappings: Record<string, unknown>,
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
    workflow_name: workflowName,
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
