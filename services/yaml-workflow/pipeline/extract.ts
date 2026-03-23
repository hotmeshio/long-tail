/**
 * Extract stage: Parse execution events into an ordered step sequence.
 *
 * Supports four patterns:
 * 1a. callLLM → callDbTool/callVisionTool (Insight/agentic paired calls)
 * 1b. callLLM → callMcpTool (mcpQuery with qualified names)
 * 2.  mcp_* activities (direct external tool calls via proxyActivities)
 * 3.  callLLM (interpretation) — final LLM text response
 */

import { listMcpServers } from '../../mcp/db';
import type { WorkflowExecutionEvent } from '../../../types';
import type {
  ActivityTaskCompletedAttributes,
} from '@hotmeshio/hotmesh/build/types/exporter';
import type { ExtractedStep, PipelineContext } from './types';

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
 * Extract the tool arguments from an enriched activity event's input.
 *
 * The enriched `input` field contains the raw arguments passed to the
 * activity function. The shape depends on the activity:
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
 * Extract the ordered step sequence from an execution's events.
 */
export function extractStepSequence(events: WorkflowExecutionEvent[]): ExtractedStep[] {
  const steps: ExtractedStep[] = [];
  let pendingLlmCall: { toolName: string; arguments: Record<string, unknown> } | null = null;
  const pendingQueue: Array<{ toolName: string; arguments: Record<string, unknown> }> = [];

  for (const evt of events) {
    if (evt.event_type !== 'activity_task_completed') continue;
    const attrs = evt.attributes as ActivityTaskCompletedAttributes & { input?: unknown };

    // Pattern 1a: callLLM/callTriageLLM with tool_calls → record pending tool call
    if (attrs.activity_type === 'callLLM' || attrs.activity_type === 'callTriageLLM' || attrs.activity_type === 'callQueryLLM') {
      const result = attrs.result as Record<string, unknown> | null;
      const toolCalls = result?.tool_calls as Array<{
        function: { name: string; arguments: string };
      }> | undefined;

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            // malformed arguments — use empty
          }
          pendingQueue.push({
            toolName: tc.function.name,
            arguments: parsedArgs,
          });
        }
        pendingLlmCall = pendingQueue.shift() || null;
        continue;
      }

      // Pattern 3: callLLM with text content (no tool_calls) — interpretation step
      const content = result?.content as string | undefined;
      if (content) {
        let parsed: unknown = content;
        try {
          const cleaned = content
            .replace(/^```(?:json)?\s*/m, '')
            .replace(/\s*```$/m, '')
            .trim();
          parsed = JSON.parse(cleaned);
        } catch {
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
      const actualArgs = extractToolArgs(attrs as unknown as Record<string, unknown>);
      const args = Object.keys(actualArgs).length > 0 ? actualArgs : pendingLlmCall.arguments;

      const isDbTool = attrs.activity_type === 'callDbTool';
      steps.push({
        kind: 'tool',
        toolName: pendingLlmCall.toolName,
        arguments: args,
        result: attrs.result,
        source: isDbTool ? 'db' : 'mcp',
        ...(!isDbTool ? { mcpServerId: attrs.activity_type!.replace(/^call/, '').replace(/Tool$/, '').toLowerCase() } : {}),
      });
      pendingLlmCall = null;
      continue;
    }

    // Pattern 1c: callMcpTool — mcpQuery uses qualified names (server_slug__tool_name)
    if (attrs.activity_type === 'callMcpTool' && pendingLlmCall) {
      const qualifiedName = pendingLlmCall.toolName;
      const sepIdx = qualifiedName.indexOf('__');
      const serverSlug = sepIdx >= 0 ? qualifiedName.slice(0, sepIdx) : qualifiedName;
      const toolName = sepIdx >= 0 ? qualifiedName.slice(sepIdx + 2) : qualifiedName;

      const actualArgs = extractToolArgs(attrs as unknown as Record<string, unknown>);
      const args = Object.keys(actualArgs).length > 0 ? actualArgs : pendingLlmCall.arguments;

      const result = attrs.result as Record<string, unknown> | null;

      // Skip failed steps
      if (result && (result.error || result.code === 'TIMEOUT')) {
        pendingLlmCall = pendingQueue.shift() || null;
        continue;
      }

      steps.push({
        kind: 'tool',
        toolName,
        arguments: args,
        result,
        source: 'mcp',
        mcpServerId: serverSlug,
      });
      pendingLlmCall = pendingQueue.shift() || null;
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
 * Resolve slugified server IDs (e.g., "my_server") back to
 * real MCP server names (e.g., "my-server").
 */
export async function resolveServerIds(steps: ExtractedStep[]): Promise<void> {
  const mcpSteps = steps.filter((s) => s.source === 'mcp' && s.mcpServerId);
  if (mcpSteps.length === 0) return;

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
 * Extract pipeline stage: parse execution events into ordered steps.
 */
export async function extract(ctx: PipelineContext): Promise<PipelineContext> {
  // Extract the original prompt: try start event first, then fall back to
  // the user message in the first callQueryLLM activity (for child workflows
  // spawned by mcpQueryRouter where input isn't in the start event).
  const startEvent = ctx.execution.events.find(e => e.event_type === 'workflow_execution_started');
  let prompt = (startEvent?.attributes as any)?.input?.prompt || '';

  if (!prompt) {
    // Look for the prompt in callQueryLLM's input messages
    for (const e of ctx.execution.events) {
      const attrs = e.attributes as unknown as Record<string, unknown>;
      if (attrs.activity_type === 'callQueryLLM' && e.event_type === 'activity_task_completed') {
        const input = attrs.input as unknown[];
        if (Array.isArray(input) && Array.isArray(input[0])) {
          const messages = input[0] as Array<{ role: string; content: string }>;
          const userMsg = messages.find(m => m.role === 'user');
          if (userMsg?.content) { prompt = userMsg.content; break; }
        }
        break;
      }
    }
  }

  // Also try findCompiledWorkflows input (router child workflows)
  if (!prompt) {
    for (const e of ctx.execution.events) {
      const attrs = e.attributes as unknown as Record<string, unknown>;
      if (attrs.activity_type === 'findCompiledWorkflows' && Array.isArray(attrs.input)) {
        const input = attrs.input as unknown[];
        if (typeof input[0] === 'string') { prompt = input[0]; break; }
      }
    }
  }

  ctx.originalPrompt = prompt;

  // Extract ordered steps
  ctx.rawSteps = extractStepSequence(ctx.execution.events);
  if (ctx.rawSteps.length === 0) {
    throw new Error(
      'No steps found in this execution. Expected callLLM→callDbTool pairs, mcp_* activities, or LLM interpretation steps.',
    );
  }

  // Resolve slugified server IDs back to real MCP server names
  await resolveServerIds(ctx.rawSteps);

  return ctx;
}
