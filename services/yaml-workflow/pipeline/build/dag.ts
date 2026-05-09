/**
 * DAG construction helpers for the build pipeline stage.
 *
 * Encapsulates the mutable state of DAG assembly (activities, transitions,
 * manifest) behind semantic operations so the main build() function reads
 * as a high-level pipeline.
 *
 * Step-appender functions (appendIterationStep, appendNormalStep,
 * appendSignalStep) live in dag-assembly.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import {
  WORKFLOW_EXPIRE_SECS,
  YAML_LINE_WIDTH,
} from '../../../../modules/defaults';
import type { ActivityManifestEntry } from '../../../../types/yaml-workflow';
import type { DagBuilder } from '../../types';

// Re-export step appenders so existing import sites continue to work
export {
  appendIterationStep,
  appendNormalStep,
  appendSignalStep,
} from './dag-assembly';

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
    hooks: {},
    manifest,
    stepIndexToActivityId: new Map(),
    prevActivityId: triggerId,
    prevResult: null,
    lastPivotId: null,
    triggerId,
  };
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
  const graph: Record<string, unknown> = {
    subscribes: graphTopic,
    expire: WORKFLOW_EXPIRE_SECS,
    input: { schema: inputSchema },
    output: { schema: outputSchema },
    activities: dag.activities,
    transitions: dag.transitions,
  };

  // Include hooks section when signal steps are present
  if (Object.keys(dag.hooks).length > 0) {
    graph.hooks = dag.hooks;
  }

  const graphDef = {
    app: {
      id: appId,
      version: '1',
      graphs: [graph],
    },
  };

  return yaml.dump(graphDef, {
    lineWidth: YAML_LINE_WIDTH,
    noRefs: true,
    sortKeys: false,
  });
}
