// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import { exportWorkflowExecution } from '../export';
import type { ActivityManifestEntry } from '../../types/yaml-workflow';
import type {
  WorkflowExecution,
  WorkflowExecutionEvent,
} from '../../types';
import type {
  ActivityTaskCompletedAttributes,
} from '@hotmeshio/hotmesh/build/types/exporter';

export interface GenerateYamlOptions {
  workflowId: string;
  taskQueue: string;
  workflowName: string;
  /** User-chosen name for the YAML workflow (used in app_id and topics) */
  name: string;
  description?: string;
}

export interface GenerateYamlResult {
  yaml: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  activityManifest: ActivityManifestEntry[];
  graphTopic: string;
  appId: string;
}

/** A tool call extracted from an execution's event timeline. */
interface ExtractedToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  source: 'db' | 'mcp';
  mcpServerId?: string;
}

/**
 * Parse an MCP activity type name back into server name + tool name.
 * Activity names follow: mcp_{serverName}_{toolName}
 */
function parseMcpActivityType(activityType: string): {
  serverName: string;
  toolName: string;
} {
  const rest = activityType.slice(4);
  const firstUnderscore = rest.indexOf('_');
  if (firstUnderscore === -1) {
    return { serverName: rest, toolName: rest };
  }
  return {
    serverName: rest.slice(0, firstUnderscore),
    toolName: rest.slice(firstUnderscore + 1),
  };
}

/**
 * Sanitize a name for use in HotMesh app IDs and topics.
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract the ordered tool call sequence from an execution's events.
 *
 * Supports two patterns:
 *
 * 1. **callLLM → callDbTool** — Insight/agentic workflows where the LLM
 *    decides which DB tool to call. The `callLLM` result contains
 *    `tool_calls[].function.name` and `tool_calls[].function.arguments`.
 *    The subsequent `callDbTool` result contains the tool output.
 *
 * 2. **mcp_* activities** — Workflows that call external MCP server tools
 *    directly via proxyActivities (e.g., vision, document tools).
 */
function extractToolCallSequence(events: WorkflowExecutionEvent[]): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];
  let pendingLlmCall: { toolName: string; arguments: Record<string, unknown> } | null = null;

  for (const evt of events) {
    if (evt.event_type !== 'activity_task_completed') continue;
    const attrs = evt.attributes as ActivityTaskCompletedAttributes;

    // Pattern 1a: callLLM with tool_calls → record pending tool call
    if (attrs.activity_type === 'callLLM') {
      const result = attrs.result as Record<string, unknown> | null;
      const toolCalls = result?.tool_calls as Array<{
        function: { name: string; arguments: string };
      }> | undefined;

      if (toolCalls && toolCalls.length > 0) {
        const tc = toolCalls[0];
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          // malformed arguments — use empty
        }
        pendingLlmCall = {
          toolName: tc.function.name,
          arguments: parsedArgs,
        };
      }
      continue;
    }

    // Pattern 1b: callDbTool — paired with the preceding callLLM
    if (attrs.activity_type === 'callDbTool' && pendingLlmCall) {
      calls.push({
        toolName: pendingLlmCall.toolName,
        arguments: pendingLlmCall.arguments,
        result: attrs.result,
        source: 'db',
      });
      pendingLlmCall = null;
      continue;
    }

    // Pattern 2: mcp_* activities (external MCP tools)
    if (attrs.activity_type?.startsWith('mcp_')) {
      const { serverName, toolName } = parseMcpActivityType(attrs.activity_type);
      calls.push({
        toolName,
        arguments: {},
        result: attrs.result,
        source: 'mcp',
        mcpServerId: serverName,
      });
      continue;
    }
  }

  return calls;
}

/**
 * Build a JSON Schema object from a sample value (shallow, single level).
 */
function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { type: 'object' };
  }
  if (Array.isArray(value)) {
    return { type: 'array' };
  }
  if (typeof value === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) props[k] = { type: 'string' };
      else if (typeof v === 'number') props[k] = { type: 'number' };
      else if (typeof v === 'boolean') props[k] = { type: 'boolean' };
      else if (Array.isArray(v)) props[k] = { type: 'array' };
      else if (typeof v === 'object') props[k] = { type: 'object' };
      else props[k] = { type: 'string' };
    }
    return { type: 'object', properties: props };
  }
  return { type: typeof value };
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

/**
 * Generate a HotMesh YAML workflow from a completed execution's tool call sequence.
 *
 * Analyzes the execution events, extracts the ordered tool calls (from both
 * callLLM→callDbTool pairs and direct mcp_* activities), and produces a
 * deterministic YAML graph that replaces the LLM with direct tool-to-tool piping.
 */
export async function generateYamlFromExecution(
  options: GenerateYamlOptions,
): Promise<GenerateYamlResult> {
  const { workflowId, taskQueue, workflowName, name, description } = options;

  // 1. Export the execution to get events
  const execution: WorkflowExecution = await exportWorkflowExecution(
    workflowId,
    taskQueue,
    workflowName,
  );

  // 2. Extract ordered tool calls (both callLLM→callDbTool and mcp_* patterns)
  const toolCalls = extractToolCallSequence(execution.events);
  if (toolCalls.length === 0) {
    throw new Error(
      'No tool calls found in this execution. Expected callLLM→callDbTool pairs or mcp_* activities.',
    );
  }

  const safeName = sanitizeName(name);
  const appId = `lt-yaml-${safeName}`;
  const graphTopic = `${appId}.execute`;

  // 3. Infer input schema from the workflow's initial input
  const startEvent = execution.events.find(
    (e) => e.event_type === 'workflow_execution_started',
  );
  const workflowInput = startEvent
    ? (startEvent.attributes as { input?: unknown }).input
    : null;
  const inputSchema = workflowInput ? inferSchema(workflowInput) : {
    type: 'object' as const,
    properties: { id: { type: 'string' } },
  };

  // 4. Infer output schema from execution result
  const outputSchema = execution.result
    ? inferSchema(execution.result)
    : { type: 'object' as const };

  // 5. Build activities and transitions
  const activities: Record<string, unknown> = {};
  const transitions: Record<string, Array<{ to: string }>> = {};
  const activityManifest: ActivityManifestEntry[] = [];

  // Trigger activity
  activities['t1'] = {
    title: 'Trigger',
    type: 'trigger',
    output: { schema: { type: 'object' } },
  };
  activityManifest.push({
    activity_id: 't1',
    title: 'Trigger',
    type: 'trigger',
    tool_source: 'trigger',
    topic: graphTopic,
    input_mappings: {},
    output_fields: Object.keys(
      (inputSchema as { properties?: Record<string, unknown> }).properties || {},
    ),
  });

  let prevActivityId = 't1';
  let prevResult: unknown = workflowInput;

  toolCalls.forEach((call, idx) => {
    const actId = `a${idx + 1}`;
    const topic = `${appId}.${call.toolName}`;
    const title = call.toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // Build input maps from previous activity output
    const inputMappings = idx === 0
      ? buildInputMappings('t1', workflowInput)
      : buildInputMappings(prevActivityId, prevResult);

    const resultSchema = call.result ? inferSchema(call.result) : { type: 'object' };
    const outputFields = call.result && typeof call.result === 'object' && !Array.isArray(call.result)
      ? Object.keys(call.result as Record<string, unknown>)
      : [];

    activities[actId] = {
      title,
      type: 'worker',
      topic,
      input: {
        schema: { type: 'object' },
        ...(Object.keys(inputMappings).length > 0 ? { maps: inputMappings } : {}),
      },
      output: { schema: resultSchema },
    };

    activityManifest.push({
      activity_id: actId,
      title,
      type: 'worker',
      tool_source: call.source,
      topic,
      mcp_server_id: call.source === 'mcp' ? call.mcpServerId : 'db',
      mcp_tool_name: call.toolName,
      tool_arguments: Object.keys(call.arguments).length > 0 ? call.arguments : undefined,
      input_mappings: inputMappings,
      output_fields: outputFields,
    });

    // Transition from previous
    transitions[prevActivityId] = [{ to: actId }];

    prevActivityId = actId;
    prevResult = call.result;
  });

  // 6. Build the full YAML graph structure
  const graphDef = {
    app: {
      id: appId,
      version: '1',
      graphs: [
        {
          subscribes: graphTopic,
          expire: 120,
          input: { schema: inputSchema },
          output: { schema: outputSchema },
          activities,
          transitions,
        },
      ],
    },
  };

  const yamlContent = yaml.dump(graphDef, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  return {
    yaml: yamlContent,
    inputSchema,
    outputSchema,
    activityManifest,
    graphTopic,
    appId,
  };
}
