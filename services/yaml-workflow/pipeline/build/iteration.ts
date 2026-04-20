/**
 * Iteration pattern builders for the build pipeline stage.
 */

import type { ActivityManifestEntry } from '../../../../types/yaml-workflow';
import type {
  ExtractedStep,
  EnhancedCompilationPlan,
  IterationSpec,
} from '../../types';

import { keysRelated, humanize, inferSchema } from './utils';

/**
 * Build iteration activities (hook -> worker -> cycle -> done) from an IterationSpec.
 *
 * When key mappings are available (from the compilation plan), uses the mapped
 * key names in the @pipe transforms so array item keys correctly map to tool args.
 */
export function buildIterationActivities(
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
  const workerTopic = graphTopic;

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
      //    e.g., tool wants 'path' -> array items have 'name' (path contains name)
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

  // Thread _scope from trigger for IAM context
  workerInputMaps._scope = `{${triggerId}.output.data._scope}`;
  // Set workflowName for singleton consumer dispatch routing
  workerInputMaps.workflowName = originalTool;

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
              // Subpipe 1: compute next_index = index + 1
              { '@pipe': [
                [`{${pivotId}.output.data.index}`, 1],
                ['{@math.add}'],
              ]},
              // Subpipe 2: compute items.length
              { '@pipe': [
                [`{${pivotId}.output.data.items}`],
                ['{@array.length}'],
              ]},
              // Row: compare next_index < items.length
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
    { activity_id: workerId, title: humanize(originalTool), type: 'worker' as const, tool_source: step.source, topic: workerTopic, workflow_name: originalTool, mcp_server_id: spec.serverId, mcp_tool_name: originalTool, input_mappings: workerInputMaps, output_fields: [] },
    { activity_id: cycleId, title: 'Next Item', type: 'worker' as const, tool_source: 'trigger', topic: graphTopic, input_mappings: {}, output_fields: [] },
    { activity_id: doneId, title: 'Iteration Complete', type: 'worker' as const, tool_source: 'trigger', topic: graphTopic, input_mappings: {}, output_fields: [] },
  ];

  return { activities, transitions, manifest, pivotId, doneId };
}

/**
 * Check if a step should be rendered as an iteration based on the compilation plan.
 */
export function findIterationSpec(
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
