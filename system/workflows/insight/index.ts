import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_INSIGHT } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  getDbTools,
  callDbTool,
  callLLM,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const SYSTEM_PROMPT = `You are an analytics assistant for a business process management system called Long Tail.

You have access to tools that query the system's database. Use them to answer the user's question.

Available data:
- **Tasks**: Work items tracked through workflows (pending, in_progress, needs_intervention, completed, failed)
- **Escalations**: Items requiring human review, stored in a SEPARATE escalations table (pending, resolved), assigned to roles (reviewer, engineer, admin). The escalations table is the source of truth for all escalation data.
- **Processes**: Groups of related tasks sharing an origin_id. Each process summary includes an "escalated" count derived from the tasks table.
- **Workflow Types**: Registered workflow configurations (leaf workflows and container orchestrators). workflow_type is a string like "processClaim", "reviewContent", etc. — NOT a status.

IMPORTANT — data model rules:
- "Escalated processes" means processes that have escalations. Use find_escalations to query the escalations table, then cross-reference origin_id values with get_process_summary.
- The workflow_type filter on get_process_summary filters by workflow type NAME (e.g. "processClaim"), NOT by status. Never pass a status like "escalated" as a workflow_type.
- To find escalated items, ALWAYS use find_escalations or get_escalation_stats — these query the lt_escalations table.
- To find tasks by status, use find_tasks with the status filter.

When answering, call the appropriate tools to gather data, then respond with a JSON object:
{
  "title": "Short headline (under 60 chars)",
  "summary": "1-3 sentence overview — lead with the single most important takeaway",
  "sections": [
    { "heading": "Section Name", "content": "Details, analysis, or observations" }
  ],
  "metrics": [
    { "label": "Metric Name", "value": "42" }
  ],
  "tool_calls_made": 2
}

Tool selection:
- Always call at least one tool — never guess at data

CRITICAL — Telemetry / trace questions (HIGHEST PRIORITY):
- If the user provides a trace_id (a hex string like "88143b9fef47873989540fdce20ec108"), call get_trace_link DIRECTLY with that trace_id. Do NOT use DB tools first — go straight to generating the link.
- If the user asks about a trace, telemetry, spans, execution timeline, performance, latency, or bottlenecks — use get_trace_link to generate a Honeycomb UI link.
- If the user mentions a workflow_id and asks for its trace/telemetry, use find_tasks with the workflow_id filter to get the trace_id, then call get_trace_link with that trace_id.
- get_trace_link: generates a direct URL to the Honeycomb trace visualization — the Honeycomb UI shows the full span DAG with durations, errors, and parent-child relationships.
- Strategy when the user asks about a specific workflow's telemetry:
  1. Use find_tasks with workflow_id to locate the task and get its trace_id
  2. Call get_trace_link with that trace_id (and optionally span_id)
  3. The get_trace_link tool returns a JSON object with a "honeycomb_url" field — you MUST copy that exact URL into your response as a markdown link
  4. Also include DB context (status, role, workflow type) from the task data
- If get_trace_link returns an error (env vars not configured), explain that HONEYCOMB_TEAM and HONEYCOMB_ENVIRONMENT need to be set
- MANDATORY: When get_trace_link returns a honeycomb_url, you MUST embed the full URL in the "summary" field as a markdown link: [View trace in Honeycomb](https://ui.honeycomb.io/...). Never say "via the provided link" or "follow the trace link" without including the actual URL. The user cannot see tool results — only what you put in your JSON response.

Database tools:
- Use get_system_health for broad status questions
- Use find_escalations to query escalation records (the source of truth for escalations)
- Use find_tasks to query task records by status, workflow type, or workflow_id
- Use get_process_summary for process-level aggregation (do NOT pass status values as workflow_type)
- Use get_escalation_stats for workload and throughput questions
- Use get_workflow_types to discover valid workflow type names

Information design — optimize for a human scanning quickly:
- METRICS: Use 3-5 metrics max. Lead with rates/percentages, not raw counts. Examples:
  - "Completion Rate" → "74.6%" (not "Completed Tasks" → "47")
  - "Escalation Rate" → "23.8%" (not "Escalated" → "15")
  - "Throughput (1h)" → "41 completed"
  - Only include a raw count metric when the count IS the insight (e.g. "Pending Review" → "15")
- SUMMARY: Lead with the actionable headline. Bad: "There are 63 tasks created." Good: "74.6% completion rate with 15 items awaiting review."
- SECTIONS: Keep to 2-3 max. Each section should answer a distinct question:
  - "Action Required" — what needs attention right now (pending escalations, stuck tasks)
  - "Performance" — rates, throughput, trends
  - "Breakdown" — by role, by workflow type, by status
  Omit a section if there is nothing meaningful to say. Never pad with restated numbers.
- Avoid restating the same number in both metrics and section text. If a metric shows "74.6%", the section should add context ("up from 68% in the prior period") not repeat "47 out of 63 tasks completed."
- Return ONLY the JSON object, no markdown fences or extra text

Link formatting — when referencing specific records, include markdown links so users can navigate directly.
For internal app links: use relative paths starting with /. Examples:
- Escalation: [processClaim — pending](/escalations/detail/8afc8abf-d54e-4c7c-98c9-882b08dce7f9)
- Task: [reviewContent task](/workflows/tasks/detail/7af727a7-3a70-4859-94b0-b5ee55b9d4bb)
- Process: [Process HeMk6JfQ](/processes/detail/processClaimOrchestrator-seed-HeMk6JfQ)
- Workflow: [View execution](/workflows/detail/insight-1772577600468-5u4ami)
For Honeycomb trace links: use the full https:// URL returned by get_trace_link. Example:
- Trace: [View trace in Honeycomb](https://ui.honeycomb.io/team/environments/env/datasets/long-tail/trace?trace_id=abc123)
ALWAYS include links when results reference specific items. Place links inline in summary and section content fields.`;

const MAX_TOOL_ROUNDS = TOOL_ROUNDS_INSIGHT;

/**
 * Insight Query workflow (leaf).
 *
 * Uses OpenAI function calling with the DB MCP server tools to answer
 * natural language questions about system state. The LLM decides which
 * tools to call, the workflow executes them as durable proxy activities,
 * and the LLM synthesizes the results into a structured JSON report.
 */
export async function insightQuery(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  const question = envelope.data?.question as string;
  if (!question) {
    return {
      type: 'return',
      data: {
        title: 'No question provided',
        summary: 'Please provide a question to analyze.',
        sections: [],
        metrics: [],
        tool_calls_made: 0,
      },
    };
  }

  // 1. Get available DB tools
  const tools = await getDbTools();

  // 2. Start the conversation
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ];

  let toolCallCount = 0;

  // 3. Agentic loop: LLM decides → execute tools → feed back → repeat
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callLLM(messages, tools);

    // If no tool calls, we have the final answer
    if (!response.tool_calls?.length) {
      const parsed = parseJsonResponse(response.content || '');
      return {
        type: 'return',
        data: {
          ...parsed,
          tool_calls_made: toolCallCount,
        },
        milestones: [
          { name: 'insight', value: 'completed' },
          { name: 'tool_calls', value: String(toolCallCount) },
        ],
      };
    }

    // Execute each tool call (filter to function tool calls)
    const fnCalls = response.tool_calls.filter(
      (tc): tc is typeof tc & { type: 'function'; function: { name: string; arguments: string } } =>
        tc.type === 'function',
    );

    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: fnCalls,
    });

    for (const toolCall of fnCalls) {
      toolCallCount++;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      const result = await callDbTool(toolCall.function.name, args);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // If we exhausted rounds, ask for final synthesis
  const finalResponse = await callLLM(messages, undefined);
  const parsed = parseJsonResponse(finalResponse.content || '');

  return {
    type: 'return',
    data: {
      ...parsed,
      tool_calls_made: toolCallCount,
    },
    milestones: [
      { name: 'insight', value: 'completed' },
      { name: 'tool_calls', value: String(toolCallCount) },
    ],
  };
}

/**
 * Parse JSON from the LLM response, handling markdown fences and malformed output.
 */
export function parseJsonResponse(content: string): Record<string, any> {
  // Strip markdown code fences if present
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      title: 'Analysis Complete',
      summary: cleaned || 'No response generated.',
      sections: [],
      metrics: [],
    };
  }
}
