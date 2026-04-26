import { startMcpQuery, startWorkflowBuilder, describeWorkflow as describeWorkflowService } from '../services/insight';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

/**
 * Execute a natural-language query against connected MCP servers.
 *
 * Requires an LLM API key (OPENAI_API_KEY or ANTHROPIC_API_KEY) to be
 * configured. Returns 503 if neither is set. Timeouts surface as 504.
 *
 * @param input.prompt — the natural-language query to execute (required)
 * @param input.tags — optional tags to scope which MCP servers are queried
 * @param input.wait — when true, blocks until the query completes; otherwise returns immediately
 * @param input.direct — when true, bypasses workflow orchestration and queries the LLM directly
 * @param input.context — optional additional context forwarded to the LLM
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { ... } }` query result from the MCP pipeline
 */
export async function mcpQuery(
  input: {
    prompt: string;
    tags?: string[];
    wait?: boolean;
    direct?: boolean;
    context?: any;
  },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.prompt || typeof input.prompt !== 'string') {
      return { status: 400, error: 'prompt is required' };
    }

    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return { status: 503, error: 'MCP queries require an LLM API key (OPENAI_API_KEY or ANTHROPIC_API_KEY)' };
    }

    const result = await startMcpQuery({
      prompt: input.prompt,
      tags: input.tags,
      wait: input.wait,
      direct: input.direct,
      context: input.context,
      userId: auth?.userId,
    });

    return { status: 200, data: result };
  } catch (err: any) {
    if (err.message?.includes('timeout') || err.message?.includes('TIMEOUT')) {
      return { status: 504, error: 'MCP query timed out. Try a simpler prompt.' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Generate a workflow definition from a natural-language description.
 *
 * Uses an LLM to produce a YAML workflow from the given prompt. Supports
 * iterative refinement by accepting prior YAML, feedback, and Q&A answers.
 * Requires an LLM API key. Timeouts surface as 504.
 *
 * @param input.prompt — natural-language description of the desired workflow (required)
 * @param input.tags — optional tags to scope available MCP tools
 * @param input.wait — when true, blocks until generation completes
 * @param input.feedback — optional refinement feedback on a previous generation
 * @param input.prior_yaml — optional YAML from a previous generation to refine
 * @param input.answers — optional answers to clarifying questions from a prior round
 * @param input.prior_questions — optional questions from a prior round for context
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { ... } }` generated workflow definition
 */
export async function buildWorkflow(
  input: {
    prompt: string;
    tags?: string[];
    wait?: boolean;
    feedback?: string;
    prior_yaml?: string;
    answers?: any;
    prior_questions?: any;
  },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.prompt || typeof input.prompt !== 'string') {
      return { status: 400, error: 'prompt is required' };
    }

    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return { status: 503, error: 'Workflow builder requires an LLM API key (OPENAI_API_KEY or ANTHROPIC_API_KEY)' };
    }

    const result = await startWorkflowBuilder({
      prompt: input.prompt,
      tags: input.tags,
      wait: input.wait,
      feedback: input.feedback,
      prior_yaml: input.prior_yaml,
      answers: input.answers,
      prior_questions: input.prior_questions,
      userId: auth?.userId,
    });

    return { status: 200, data: result };
  } catch (err: any) {
    if (err.message?.includes('timeout') || err.message?.includes('TIMEOUT')) {
      return { status: 504, error: 'Workflow builder timed out. Try a simpler description.' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Refine an existing workflow definition using feedback.
 *
 * Takes a previously generated YAML workflow, the original prompt, and
 * user feedback, then produces an updated workflow definition.
 *
 * @param input.prompt — original natural-language description (required)
 * @param input.prior_yaml — the YAML workflow to refine (required)
 * @param input.feedback — user feedback describing desired changes (required)
 * @param input.tags — optional tags to scope available MCP tools
 * @param input.wait — when true, blocks until refinement completes
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { ... } }` refined workflow definition
 */
export async function refineWorkflow(
  input: {
    prompt: string;
    prior_yaml: string;
    feedback: string;
    tags?: string[];
    wait?: boolean;
  },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.prompt || !input.prior_yaml || !input.feedback) {
      return { status: 400, error: 'prompt, prior_yaml, and feedback are required' };
    }

    const result = await startWorkflowBuilder({
      prompt: input.prompt,
      tags: input.tags,
      wait: input.wait,
      feedback: input.feedback,
      prior_yaml: input.prior_yaml,
      userId: auth?.userId,
    });

    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Generate a human-readable description and tags for a workflow.
 *
 * Uses an LLM to produce a concise description from the prompt and
 * optional result metadata. Falls back to the raw prompt as the
 * description if the LLM call fails.
 *
 * @param input.prompt — the workflow prompt or content to describe (required)
 * @param input.result_title — optional title from the workflow result for additional context
 * @param input.result_summary — optional summary from the workflow result for additional context
 * @returns `{ status: 200, data: { description, tags } }` generated description and tag array
 */
export async function describeWorkflow(input: {
  prompt: string;
  result_title?: string;
  result_summary?: string;
}): Promise<LTApiResult> {
  try {
    if (!input.prompt) {
      return { status: 400, error: 'prompt is required' };
    }

    const result = await describeWorkflowService(input);
    return { status: 200, data: result };
  } catch {
    return { status: 200, data: { description: input.prompt || '', tags: [] } };
  }
}
