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
  /** User-chosen name for the YAML workflow */
  name: string;
  description?: string;
  /** HotMesh app namespace (shared across flows). Defaults to 'mcpyaml'. */
  appId?: string;
  /** Graph subscribes topic. Defaults to sanitized name. */
  subscribes?: string;
}

export interface GenerateYamlResult {
  yaml: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  activityManifest: ActivityManifestEntry[];
  graphTopic: string;
  appId: string;
}

/** A step extracted from an execution's event timeline. */
interface ExtractedStep {
  /** Step kind: 'tool' for DB/MCP tool calls, 'llm' for LLM interpretation */
  kind: 'tool' | 'llm';
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  source: 'db' | 'mcp' | 'llm';
  mcpServerId?: string;
  /** For LLM steps: the system/user messages that produced this response */
  promptMessages?: Array<{ role: string; content: string }>;
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
 * Extract the ordered step sequence from an execution's events.
 *
 * Supports three patterns:
 *
 * 1. **callLLM → callDbTool** — Insight/agentic workflows where the LLM
 *    decides which DB tool to call. The `callLLM` result contains
 *    `tool_calls[].function.name` and `tool_calls[].function.arguments`.
 *    The subsequent `callDbTool` result contains the tool output.
 *
 * 2. **mcp_* activities** — Workflows that call external MCP server tools
 *    directly via proxyActivities (e.g., vision, document tools).
 *
 * 3. **callLLM (interpretation)** — A final callLLM that produces text
 *    content (no tool_calls). This is the LLM synthesizing/interpreting
 *    tool results into a structured response.
 */
function extractStepSequence(events: WorkflowExecutionEvent[]): ExtractedStep[] {
  const steps: ExtractedStep[] = [];
  let pendingLlmCall: { toolName: string; arguments: Record<string, unknown> } | null = null;

  for (const evt of events) {
    if (evt.event_type !== 'activity_task_completed') continue;
    const attrs = evt.attributes as ActivityTaskCompletedAttributes;

    // Pattern 1a: callLLM/callTriageLLM with tool_calls → record pending tool call
    if (attrs.activity_type === 'callLLM' || attrs.activity_type === 'callTriageLLM') {
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
        continue;
      }

      // Pattern 3: callLLM with text content (no tool_calls) — interpretation step
      const content = result?.content as string | undefined;
      if (content) {
        // Try to parse JSON from LLM response to get output schema
        let parsed: unknown = content;
        try {
          const cleaned = content
            .replace(/^```(?:json)?\s*/m, '')
            .replace(/\s*```$/m, '')
            .trim();
          parsed = JSON.parse(cleaned);
        } catch {
          // Keep as raw string — wrap in object for schema consistency
          parsed = { response: content };
        }

        steps.push({
          kind: 'llm',
          toolName: 'interpret',
          arguments: {},
          result: parsed,
          source: 'llm',
          promptMessages: buildDefaultPrompt(steps),
        });
      }
      continue;
    }

    // Pattern 1b: callDbTool/callVisionTool — paired with the preceding callLLM
    if ((attrs.activity_type === 'callDbTool' || attrs.activity_type === 'callVisionTool') && pendingLlmCall) {
      steps.push({
        kind: 'tool',
        toolName: pendingLlmCall.toolName,
        arguments: pendingLlmCall.arguments,
        result: attrs.result,
        source: attrs.activity_type === 'callVisionTool' ? 'mcp' : 'db',
        ...(attrs.activity_type === 'callVisionTool' ? { mcpServerId: 'vision' } : {}),
      });
      pendingLlmCall = null;
      continue;
    }

    // Pattern 2: mcp_* activities (external MCP tools)
    if (attrs.activity_type?.startsWith('mcp_')) {
      const { serverName, toolName } = parseMcpActivityType(attrs.activity_type);
      steps.push({
        kind: 'tool',
        toolName,
        arguments: {},
        result: attrs.result,
        source: 'mcp',
        mcpServerId: serverName,
      });
      continue;
    }
  }

  return steps;
}

/**
 * Build a default prompt template referencing the data available from prior tool steps.
 * The prompt uses {field} placeholders that map to input_maps at runtime.
 */
function buildDefaultPrompt(priorSteps: ExtractedStep[]): Array<{ role: string; content: string }> {
  const lastToolStep = [...priorSteps].reverse().find((s) => s.kind === 'tool');
  const fields = lastToolStep?.result && typeof lastToolStep.result === 'object' && !Array.isArray(lastToolStep.result)
    ? Object.keys(lastToolStep.result as Record<string, unknown>)
    : [];

  const dataRef = fields.length > 0
    ? `The data includes the following fields: ${fields.join(', ')}.`
    : 'Analyze the provided data.';

  return [
    { role: 'system', content: `You are a data analysis assistant. Interpret the provided data and return a structured JSON response with: title, summary, sections (array of {heading, content}), and metrics (array of {label, value}).` },
    { role: 'user', content: `${dataRef}\n\nData:\n{input_data}\n\nProvide a concise analysis.` },
  ];
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

  // 2. Extract ordered steps (tool calls + LLM interpretation steps)
  const steps = extractStepSequence(execution.events);
  if (steps.length === 0) {
    throw new Error(
      'No steps found in this execution. Expected callLLM→callDbTool pairs, mcp_* activities, or LLM interpretation steps.',
    );
  }

  const appId = options.appId || 'mcpyaml';
  const graphTopic = options.subscribes || sanitizeName(name);

  // 3. Infer input schema from the first tool step's arguments.
  const firstToolStep = steps.find((s) => s.kind === 'tool');
  const firstCallArgs = firstToolStep?.arguments ?? {};
  const inputSchema = Object.keys(firstCallArgs).length > 0
    ? inferSchema(firstCallArgs)
    : { type: 'object' as const };

  // 4. Infer output schema from the last step's result.
  const lastStep = steps[steps.length - 1];
  const outputSchema = lastStep.result
    ? inferSchema(lastStep.result)
    : { type: 'object' as const };

  // 5. Build activities and transitions
  // Prefix activity IDs with graph topic to ensure uniqueness across
  // merged graphs sharing the same app_id.
  const prefix = graphTopic.replace(/[^a-z0-9]/g, '_');
  const activities: Record<string, unknown> = {};
  const transitions: Record<string, Array<{ to: string }>> = {};
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
  let prevResult: unknown = firstCallArgs;

  steps.forEach((step, idx) => {
    const actId = `${prefix}_a${idx + 1}`;
    const topicSuffix = step.kind === 'llm' ? 'interpret' : step.toolName;
    const topic = `${graphTopic}.${topicSuffix}`;
    const title = step.kind === 'llm'
      ? 'LLM Interpret'
      : step.toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // Build input maps from previous activity output.
    const inputMappings = idx === 0
      ? buildInputMappings(triggerId, firstCallArgs)
      : buildInputMappings(prevActivityId, prevResult);

    const resultSchema = step.result ? inferSchema(step.result) : { type: 'object' };
    const outputFields = step.result && typeof step.result === 'object' && !Array.isArray(step.result)
      ? Object.keys(step.result as Record<string, unknown>)
      : [];

    // Build job maps for the last activity — this sets the job result data
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
        tool_arguments: Object.keys(step.arguments).length > 0 ? step.arguments : undefined,
      } : {}),
      input_mappings: inputMappings,
      output_fields: outputFields,
      ...(promptTemplate ? { prompt_template: promptTemplate } : {}),
      ...(step.kind === 'llm' ? { model: 'gpt-4o-mini' } : {}),
    });

    // Transition from previous
    transitions[prevActivityId] = [{ to: actId }];

    prevActivityId = actId;
    prevResult = step.result;
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
