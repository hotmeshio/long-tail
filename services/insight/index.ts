/**
 * Insight service — business logic for MCP query invocation and
 * workflow description generation.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../lib/db';
import { JOB_EXPIRE_SECS, LLM_MODEL_SECONDARY } from '../../modules/defaults';
import { callLLM, hasLLMApiKey } from '../llm';
import { DESCRIBE_WORKFLOW_SYSTEM_PROMPT } from './prompts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface McpQueryInput {
  prompt: string;
  tags?: string[];
  wait?: boolean;
  direct?: boolean;
  context?: Record<string, any>;
  userId?: string;
}

export interface McpQueryResult {
  workflow_id: string;
  status?: string;
  prompt: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface DescribeInput {
  prompt: string;
  result_title?: string;
  result_summary?: string;
}

export interface DescribeResult {
  tool_name?: string;
  description: string;
  tags: string[];
}

// ── MCP query invocation ─────────────────────────────────────────────────────

export async function startMcpQuery(input: McpQueryInput): Promise<McpQueryResult> {
  const { prompt, tags, wait = true, direct = false, context, userId } = input;
  const startTime = Date.now();

  const client = new Durable.Client({ connection: getConnection() });

  const wfName = direct ? 'mcpQuery' : 'mcpQueryRouter';
  const entity = direct ? 'mcpQuery' : 'mcpQueryRouter';
  const prefix = direct ? 'mcp-query-direct' : 'mcp-query';
  const workflowId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const handle = await client.workflow.start({
    args: [{
      data: { prompt, tags, context },
      metadata: { source: 'dashboard' },
      lt: { userId },
    }],
    taskQueue: 'long-tail-system',
    workflowName: wfName,
    workflowId,
    expire: JOB_EXPIRE_SECS,
    entity,
  } as any);

  if (wait === false) {
    return { workflow_id: workflowId, status: 'started', prompt };
  }

  const result = await handle.result<Record<string, any>>({ state: true });
  const data = (result as any)?.data || result;

  return {
    ...data,
    prompt,
    workflow_id: workflowId,
    duration_ms: Date.now() - startTime,
  };
}

// ── Workflow builder invocation ───────────────────────────────────────────────

export interface WorkflowBuilderInput {
  prompt: string;
  tags?: string[];
  wait?: boolean;
  feedback?: string;
  prior_yaml?: string;
  answers?: string;
  prior_questions?: string[];
  userId?: string;
}

export async function startWorkflowBuilder(input: WorkflowBuilderInput): Promise<McpQueryResult> {
  const { prompt, tags, wait = true, feedback, prior_yaml, answers, prior_questions, userId } = input;
  const startTime = Date.now();

  const client = new Durable.Client({ connection: getConnection() });

  const workflowId = `wf-builder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const handle = await client.workflow.start({
    args: [{
      data: { prompt, tags, feedback, prior_yaml, answers, prior_questions },
      metadata: { source: 'dashboard' },
      lt: { userId },
    }],
    taskQueue: 'long-tail-system',
    workflowName: 'mcpWorkflowBuilder',
    workflowId,
    expire: JOB_EXPIRE_SECS,
    entity: 'mcpWorkflowBuilder',
  } as any);

  if (wait === false) {
    return { workflow_id: workflowId, status: 'started', prompt };
  }

  const result = await handle.result<Record<string, any>>({ state: true });
  const data = (result as any)?.data || result;

  return {
    ...data,
    prompt,
    workflow_id: workflowId,
    duration_ms: Date.now() - startTime,
  };
}

// ── Workflow planner invocation ──────────────────────────────────────────────

export interface WorkflowPlannerInput {
  specification: string;
  setId: string;
  wait?: boolean;
  userId?: string;
}

export async function startWorkflowPlanner(input: WorkflowPlannerInput): Promise<McpQueryResult> {
  const { specification, setId, wait = true, userId } = input;
  const startTime = Date.now();

  const client = new Durable.Client({ connection: getConnection() });

  const workflowId = `wf-planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const handle = await client.workflow.start({
    args: [{
      data: { specification, setId },
      metadata: { source: 'dashboard' },
      lt: { userId },
    }],
    taskQueue: 'long-tail-system',
    workflowName: 'mcpWorkflowPlanner',
    workflowId,
    expire: JOB_EXPIRE_SECS,
    entity: 'mcpWorkflowPlanner',
  } as any);

  if (wait === false) {
    return { workflow_id: workflowId, status: 'started', prompt: specification.slice(0, 200) };
  }

  const result = await handle.result<Record<string, any>>({ state: true });
  const data = (result as any)?.data || result;

  return {
    ...data,
    prompt: specification.slice(0, 200),
    workflow_id: workflowId,
    duration_ms: Date.now() - startTime,
  };
}

// ── Workflow description generation ──────────────────────────────────────────

export async function describeWorkflow(input: DescribeInput): Promise<DescribeResult> {
  const { prompt, result_title, result_summary } = input;

  if (!hasLLMApiKey(LLM_MODEL_SECONDARY)) {
    return { description: prompt, tags: [] };
  }

  const userContent = [
    `Original query: "${prompt}"`,
    result_title ? `Result: ${result_title}` : '',
    result_summary ? `Summary: ${result_summary.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');

  const response = await callLLM({
    model: LLM_MODEL_SECONDARY,
    max_tokens: 300,
    messages: [
      { role: 'system', content: DESCRIBE_WORKFLOW_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const raw = response.content || '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  const parsed = JSON.parse(cleaned);

  const toolName = (parsed.tool_name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return {
    tool_name: toolName || undefined,
    description: parsed.description || prompt,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}
