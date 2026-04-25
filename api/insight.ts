import { startMcpQuery, startWorkflowBuilder, describeWorkflow as describeWorkflowService } from '../services/insight';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

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
