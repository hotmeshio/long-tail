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
import type { ExtractedStep, PipelineContext } from '../types';
import {
  parseMcpActivityType,
  extractToolArgs,
  extractLlmMessages,
  buildDefaultPrompt,
} from './extract-helpers';

/**
 * Extract the ordered step sequence from an execution's events.
 */
export function extractStepSequence(events: WorkflowExecutionEvent[]): ExtractedStep[] {
  const steps: ExtractedStep[] = [];
  let pendingLlmCall: { toolName: string; arguments: Record<string, unknown> } | null = null;
  const pendingQueue: Array<{ toolName: string; arguments: Record<string, unknown> }> = [];

  // Pre-index signaled events for pairing with escalate_and_wait tool calls
  const signaledEvents = new Map<string, Record<string, unknown>>();
  for (const evt of events) {
    if (evt.event_type === 'workflow_execution_signaled') {
      const attrs = evt.attributes as unknown as Record<string, unknown>;
      const signalName = attrs.signal_name as string;
      const input = attrs.input as Record<string, unknown>;
      if (signalName && input) {
        signaledEvents.set(signalName, input);
      }
    }
  }

  for (const evt of events) {
    if (evt.event_type !== 'activity_task_completed') continue;
    const attrs = evt.attributes as ActivityTaskCompletedAttributes & { input?: unknown };

    // Pattern 1a: callLLM/callTriageLLM with tool_calls — record pending tool call
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

    // Pattern 1c: callMcpTool/callTriageTool — uses qualified names (server_slug__tool_name)
    if ((attrs.activity_type === 'callMcpTool' || attrs.activity_type === 'callTriageTool') && pendingLlmCall) {
      const qualifiedName = pendingLlmCall.toolName;
      const sepIdx = qualifiedName.indexOf('__');
      const serverSlug = sepIdx >= 0 ? qualifiedName.slice(0, sepIdx) : qualifiedName;
      const toolName = sepIdx >= 0 ? qualifiedName.slice(sepIdx + 2) : qualifiedName;

      const actualArgs = extractToolArgs(attrs as unknown as Record<string, unknown>);
      const args = Object.keys(actualArgs).length > 0 ? actualArgs : pendingLlmCall.arguments;

      const result = attrs.result as Record<string, unknown> | string | null;

      // Skip failed steps — detect both object errors and string error messages
      // (e.g., Playwright timeout errors return as plain error strings)
      if (result && (
        (typeof result === 'object' && (result.error || result.code === 'TIMEOUT')) ||
        (typeof result === 'string' && /error|timeout|failed|ECONNREFUSED/i.test(result))
      )) {
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

      // Detect escalate_and_wait → waitFor pattern: emit a signal step
      if (typeof result === 'object' && result?.type === 'waitFor' && result?.signalId) {
        const signalId = result.signalId as string;
        const signalData = signaledEvents.get(signalId) || {};
        const formSchema = (args as Record<string, unknown>).form_schema as Record<string, unknown> | undefined;

        steps.push({
          kind: 'signal',
          toolName: 'wait_for_human',
          arguments: {},
          result: signalData,
          source: 'signal',
          signalSchema: formSchema || {
            type: 'object',
            properties: signalData
              ? Object.fromEntries(
                  Object.keys(signalData).map(k => [k, { type: 'string' }]),
                )
              : {},
          },
        });
      }

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
    // Look for the prompt in the LLM call's input messages (mcpQuery or mcpTriage)
    const llmActivityTypes = ['callQueryLLM', 'callTriageLLM'];
    for (const e of ctx.execution.events) {
      const attrs = e.attributes as unknown as Record<string, unknown>;
      if (llmActivityTypes.includes(attrs.activity_type as string) && e.event_type === 'activity_task_completed') {
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

  // Also try discovery activity input (router child workflows — both query and triage)
  if (!prompt) {
    const discoveryTypes = ['findCompiledWorkflows', 'findTriageWorkflows'];
    for (const e of ctx.execution.events) {
      const attrs = e.attributes as unknown as Record<string, unknown>;
      if (discoveryTypes.includes(attrs.activity_type as string) && Array.isArray(attrs.input)) {
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
