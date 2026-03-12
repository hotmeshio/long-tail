// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import { exportWorkflowExecution } from '../export';
import { listMcpServers } from '../mcp/db';
import {
  LLM_MODEL_SECONDARY,
  TOOL_ARG_LIMIT_CAP,
  WORKFLOW_EXPIRE_SECS,
  YAML_LINE_WIDTH,
} from '../../modules/defaults';
import type { ActivityManifestEntry } from '../../types/yaml-workflow';
import type {
  WorkflowExecution,
  WorkflowExecutionEvent,
} from '../../types';
import type {
  ActivityTaskCompletedAttributes,
} from '@hotmeshio/hotmesh/build/types/exporter';

/** Cap `limit` in tool arguments to avoid sending huge payloads to downstream LLM steps. */
export function capToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const capped = { ...args };
  if (typeof capped.limit === 'number' && capped.limit > TOOL_ARG_LIMIT_CAP) {
    capped.limit = TOOL_ARG_LIMIT_CAP;
  }
  return capped;
}

export interface GenerateYamlOptions {
  workflowId: string;
  taskQueue: string;
  workflowName: string;
  /** User-chosen name for the YAML workflow */
  name: string;
  description?: string;
  /** HotMesh app namespace (shared across flows). Defaults to 'longtail'. */
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
  tags: string[];
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
 * Supports four patterns:
 *
 * 1a. **callLLM → callDbTool/callVisionTool** — Insight/agentic workflows where the LLM
 *     decides which DB/vision tool to call. The `callLLM` result contains
 *     `tool_calls[].function.name` and `tool_calls[].function.arguments`.
 *     The subsequent callDbTool/callVisionTool result contains the tool output.
 *
 * 1b. **callLLM → callMcpTool** — mcpQuery workflows where the LLM chooses
 *     any MCP tool via qualified names (server_slug__tool_name). The callMcpTool
 *     result contains the tool output.
 *
 * 2. **mcp_* activities** — Workflows that call external MCP server tools
 *    directly via proxyActivities (e.g., vision, document tools).
 *
 * 3. **callLLM (interpretation)** — A final callLLM that produces text
 *    content (no tool_calls). This is the LLM synthesizing/interpreting
 *    tool results into a structured response.
 */
/**
 * Extract the tool arguments from an enriched activity event's input.
 *
 * The enriched `input` field (from ebh,0) contains the raw arguments
 * passed to the activity function. The shape depends on the activity:
 * - callMcpTool(qualifiedName, args) → [qualifiedName, args]
 * - callDbTool(name, args) → [name, args]
 * - callLLM(messages, tools?) → [messages, tools?]
 * - mcp_* activities(args) → [args]
 */
function extractToolArgs(attrs: Record<string, unknown>): Record<string, unknown> {
  const input = attrs.input as unknown[] | undefined;
  if (!input || !Array.isArray(input)) return {};

  // callMcpTool / callDbTool / callVisionTool: [name, args]
  if (['callMcpTool', 'callDbTool', 'callVisionTool'].includes(attrs.activity_type as string)) {
    const args = input[1];
    return (args && typeof args === 'object' && !Array.isArray(args))
      ? args as Record<string, unknown>
      : {};
  }

  // mcp_* activities: [args] (single argument — the tool parameters)
  if ((attrs.activity_type as string)?.startsWith('mcp_')) {
    const args = input[0];
    return (args && typeof args === 'object' && !Array.isArray(args))
      ? args as Record<string, unknown>
      : {};
  }

  return {};
}

/**
 * Extract the LLM prompt messages from an enriched callLLM event's input.
 * callLLM(messages, tools?) → input = [messages, tools?]
 */
function extractLlmMessages(attrs: Record<string, unknown>): Array<{ role: string; content: string }> | undefined {
  const input = attrs.input as unknown[] | undefined;
  if (!input || !Array.isArray(input) || input.length === 0) return undefined;
  const messages = input[0];
  if (!Array.isArray(messages)) return undefined;
  return messages.filter((m: any) => m?.role && m?.content) as Array<{ role: string; content: string }>;
}

function extractStepSequence(events: WorkflowExecutionEvent[]): ExtractedStep[] {
  const steps: ExtractedStep[] = [];
  let pendingLlmCall: { toolName: string; arguments: Record<string, unknown> } | null = null;

  for (const evt of events) {
    if (evt.event_type !== 'activity_task_completed') continue;
    const attrs = evt.attributes as ActivityTaskCompletedAttributes & { input?: unknown };

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
          promptMessages: extractLlmMessages(attrs as unknown as Record<string, unknown>) || buildDefaultPrompt(steps),
        });
      }
      continue;
    }

    // Pattern 1b: callDbTool/callVisionTool — paired with the preceding callLLM
    if ((attrs.activity_type === 'callDbTool' || attrs.activity_type === 'callVisionTool') && pendingLlmCall) {
      // Prefer the actual input args over the LLM's stated args
      const actualArgs = extractToolArgs(attrs as unknown as Record<string, unknown>);
      const args = Object.keys(actualArgs).length > 0 ? actualArgs : pendingLlmCall.arguments;

      steps.push({
        kind: 'tool',
        toolName: pendingLlmCall.toolName,
        arguments: args,
        result: attrs.result,
        source: attrs.activity_type === 'callVisionTool' ? 'mcp' : 'db',
        ...(attrs.activity_type === 'callVisionTool' ? { mcpServerId: 'vision' } : {}),
      });
      pendingLlmCall = null;
      continue;
    }

    // Pattern 1c: callMcpTool — mcpQuery uses qualified names (server_slug__tool_name)
    // paired with the preceding callLLM that chose the tool
    if (attrs.activity_type === 'callMcpTool' && pendingLlmCall) {
      // Parse qualified name to extract server and tool
      const qualifiedName = pendingLlmCall.toolName;
      const sepIdx = qualifiedName.indexOf('__');
      const serverSlug = sepIdx >= 0 ? qualifiedName.slice(0, sepIdx) : qualifiedName;
      const toolName = sepIdx >= 0 ? qualifiedName.slice(sepIdx + 2) : qualifiedName;

      // Prefer the actual input args over the LLM's stated args
      const actualArgs = extractToolArgs(attrs as unknown as Record<string, unknown>);
      const args = Object.keys(actualArgs).length > 0 ? actualArgs : pendingLlmCall.arguments;

      steps.push({
        kind: 'tool',
        toolName,
        arguments: args,
        result: attrs.result,
        source: 'mcp',
        mcpServerId: serverSlug,
      });
      pendingLlmCall = null;
      continue;
    }

    // Pattern 2: mcp_* activities (external MCP tools called via proxyActivities)
    if (attrs.activity_type?.startsWith('mcp_')) {
      const { serverName, toolName } = parseMcpActivityType(attrs.activity_type);
      const args = extractToolArgs(attrs as unknown as Record<string, unknown>);

      steps.push({
        kind: 'tool',
        toolName,
        arguments: args,
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
 * Infer a JSON Schema from a sample value, recursively.
 *
 * Produces a rich schema with:
 * - `items` for arrays (merged from all elements)
 * - `default` values from the captured execution
 * - `description` hints derived from field names
 *
 * @param value    - The sample value to infer from
 * @param withDefault - When true, embed `value` as the schema's `default`
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

    // Infer items schema from the union of all elements
    if (value.length > 0) {
      if (value.every((v) => typeof v === 'string')) {
        schema.items = { type: 'string' };
      } else if (value.every((v) => typeof v === 'number')) {
        schema.items = { type: 'number' };
      } else if (value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
        // Merge all object keys to build a union items schema
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
    const schema: Record<string, unknown> = { type: 'object', properties: props };
    if (withDefault) schema.default = value;
    return schema;
  }

  return { type: 'string' };
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
 * Resolve slugified server IDs (e.g., "long_tail_playwright") back to
 * real MCP server names (e.g., "long-tail-playwright").
 *
 * mcpQuery qualifies tool names as `server_slug__tool_name` where the slug
 * replaces non-alphanumeric chars with underscores. The YAML worker needs
 * the real server name to call `callServerTool`.
 */
async function resolveServerIds(steps: ExtractedStep[]): Promise<void> {
  const mcpSteps = steps.filter((s) => s.source === 'mcp' && s.mcpServerId);
  if (mcpSteps.length === 0) return;

  // Build slug → real name map from registered MCP servers
  const { servers } = await listMcpServers({ limit: 100 });
  const slugToName = new Map<string, string>();
  for (const srv of servers) {
    const slug = srv.name.replace(/[^a-zA-Z0-9]/g, '_');
    slugToName.set(slug, srv.name);
  }

  for (const step of mcpSteps) {
    const realName = slugToName.get(step.mcpServerId!);
    if (realName) {
      step.mcpServerId = realName;
    }
  }
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

  // 2b. Resolve slugified server IDs back to real MCP server names.
  // mcpQuery stores tools as `server_slug__tool_name` where slug uses underscores,
  // but callServerTool needs the original name (e.g., "long-tail-playwright").
  await resolveServerIds(steps);

  // 2c. Advisory: consecutive single-action playwright steps could use run_script
  const consecutivePlaywright = steps.filter((s, i) =>
    s.mcpServerId === 'long-tail-playwright' &&
    i > 0 && steps[i - 1].mcpServerId === 'long-tail-playwright',
  );
  if (consecutivePlaywright.length > 0) {
    const { loggerRegistry } = await import('../logger');
    loggerRegistry.info(
      `[yaml-workflow] hint: ${consecutivePlaywright.length + 1} consecutive playwright steps detected — consider run_script for single-activity execution`,
    );
  }

  const appId = options.appId || 'longtail';
  const graphTopic = options.subscribes || sanitizeName(name);

  // 3. Infer input schema from the first tool step's arguments.
  //    withDefault=true embeds captured values so the invoke form pre-populates.
  const firstToolStep = steps.find((s) => s.kind === 'tool');
  const firstCallArgs = firstToolStep?.arguments ?? {};
  const inputSchema = Object.keys(firstCallArgs).length > 0
    ? inferSchema(firstCallArgs, true)
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

  // 6. Build the full YAML graph structure
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

  // 7. Auto-generate tags from the tool calls for capability-based discovery
  const tags = deriveTagsFromSteps(steps, name, description);

  return {
    yaml: yamlContent,
    inputSchema,
    outputSchema,
    activityManifest,
    graphTopic,
    appId,
    tags,
  };
}

/**
 * Derive searchable tags from the extracted steps.
 * Tags enable mcpQuery to efficiently locate compiled workflows
 * that match a user's request without scanning all tools.
 */
function deriveTagsFromSteps(
  steps: ExtractedStep[],
  name: string,
  description?: string,
): string[] {
  const tags = new Set<string>();

  // Add tags from tool names and server IDs
  for (const step of steps) {
    if (step.kind === 'tool') {
      // Tool name as tag (e.g., "find_tasks", "screenshot", "navigate")
      tags.add(step.toolName);

      // Server slug as tag (e.g., "db", "playwright", "vision")
      if (step.mcpServerId) {
        tags.add(step.mcpServerId);
      }

      // Source type as tag
      tags.add(step.source);
    }
  }

  // Extract meaningful words from name and description
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

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was',
  'not', 'but', 'has', 'have', 'had', 'been', 'will', 'can', 'all',
]);
