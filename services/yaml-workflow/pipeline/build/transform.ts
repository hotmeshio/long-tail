/**
 * Transform edge insertion logic for the build pipeline stage.
 *
 * Handles inserting reshape activities before steps that have transform edges
 * in their compilation plan data flow.
 */

import type { ActivityManifestEntry } from '../../../../types/yaml-workflow';
import type {
  ExtractedStep,
  EnhancedCompilationPlan,
} from '../../types';

import { humanize } from './utils';

/**
 * Insert transform (reshape) activities for data flow edges that require field mapping.
 *
 * Returns the new prevActivityId after any transforms are inserted.
 */
export function insertTransformActivities(
  idx: number,
  plan: EnhancedCompilationPlan,
  steps: ExtractedStep[],
  prefix: string,
  graphTopic: string,
  triggerId: string,
  triggerInputKeys: Set<string>,
  stepIndexToActivityId: Map<number, string>,
  collapsedToCoreIndex: Map<number, number>,
  activities: Record<string, unknown>,
  transitions: Record<string, Array<{ to: string; conditions?: Record<string, unknown> }>>,
  activityManifest: ActivityManifestEntry[],
  prevActivityId: string,
): string {
  const collapsedIdx = collapsedToCoreIndex?.size
    ? [...collapsedToCoreIndex.entries()].find(([_, core]) => core === idx)?.[0] ?? idx
    : idx;
  const transformEdges = plan.dataFlow.filter(
    e => e.toStep === collapsedIdx && e.transform && Object.keys(e.transform.fieldMap).length > 0,
  );

  for (let ei = 0; ei < transformEdges.length; ei++) {
    const edge = transformEdges[ei];
    // Include edge index to avoid collisions when multiple transforms target the same step
    const transformId = transformEdges.length === 1
      ? `${prefix}_xf${idx + 1}`
      : `${prefix}_xf${idx + 1}_${ei}`;
    const transformTopic = graphTopic;
    const transformWorkflowName = `reshape_${edge.toField}`;

    // Wire transform input: source field from prior step + all trigger inputs
    // (trigger inputs needed for dynamic derivation prefixes like screenshot_dir)
    // Also wire ALL output fields from the source step so the transform has
    // full context (e.g., script_result, session handles) for reshaping.
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
        // Wire all other output fields from the source step so the transform
        // can access them (e.g., script_result needed for reshaping)
        const sourceIdx = remappedFrom as number;
        if (sourceIdx >= 0 && sourceIdx < steps.length) {
          const sourceResult = steps[sourceIdx].result;
          if (sourceResult && typeof sourceResult === 'object' && !Array.isArray(sourceResult)) {
            for (const field of Object.keys(sourceResult as Record<string, unknown>)) {
              if (!transformInputMaps[field]) {
                transformInputMaps[field] = `{${sourceActId}.output.data.${field}}`;
              }
            }
          }
        }
      }
    }

    // Set workflowName for singleton consumer dispatch routing
    transformInputMaps.workflowName = transformWorkflowName;

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
      workflow_name: transformWorkflowName,
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

    // Transition from previous -> transform
    transitions[prevActivityId] = [{ to: transformId }];
    prevActivityId = transformId;
  }

  return prevActivityId;
}
