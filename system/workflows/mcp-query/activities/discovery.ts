import { callLLM as callLLMService } from '../../../../services/llm';
import { LLM_MODEL_SECONDARY, STOP_WORDS } from '../../../../modules/defaults';
import { loggerRegistry } from '../../../../services/logger';
import * as yamlDb from '../../../../services/yaml-workflow/db';
import { WORKFLOW_MATCH_PROMPT, EXTRACT_INPUTS_PROMPT } from '../prompts';
import type { WorkflowCandidate } from '../../../../types/discovery';
import { yamlWorkflowMap, toolDefCache } from './caches';

/**
 * Phase 1: Ranked discovery of compiled YAML workflows.
 *
 * Uses PostgreSQL full-text search (tsvector) + tag overlap for
 * multi-signal ranked matching. Returns candidates for the LLM judge.
 */
export async function findCompiledWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  toolIds: string[];
  candidates: WorkflowCandidate[];
}> {
  // Extract keywords for tag-overlap signal
  const keywords = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Ranked discovery: FTS + tag overlap
  loggerRegistry.debug(`[mcpQuery:findCompiledWorkflows] keywords: [${keywords.join(',')}]`);
  const workflows = await yamlDb.discoverWorkflows(prompt, keywords, undefined, 5);
  loggerRegistry.info(`[mcpQuery:findCompiledWorkflows] ${workflows.length} candidate(s) found`);

  if (workflows.length === 0) {
    return { inventory: '', toolIds: [], candidates: [] };
  }

  const toolIds: string[] = [];
  const inventoryLines: string[] = [];
  const candidates: WorkflowCandidate[] = [];

  for (const wf of workflows) {
    const qualifiedName = `yaml__${wf.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    yamlWorkflowMap.set(qualifiedName, wf.name);

    toolDefCache.set(qualifiedName, {
      type: 'function' as const,
      function: {
        name: qualifiedName,
        description: `[COMPILED WORKFLOW] ${wf.description || wf.name} — deterministic, no LLM needed. ` +
          `Tags: ${wf.tags.join(', ')}`,
        parameters: (wf.input_schema || { type: 'object', properties: {} }) as Record<string, unknown>,
      },
    });

    toolIds.push(qualifiedName);

    const activityCount = wf.activity_manifest.filter((a: any) => a.type === 'worker').length;
    inventoryLines.push(
      `★ ${wf.name} [compiled, ${activityCount} steps, tags: ${wf.tags.join(', ')}]: ${wf.description || 'deterministic workflow'}`
    );

    candidates.push({
      name: wf.name,
      description: wf.description,
      original_prompt: wf.original_prompt,
      category: wf.category,
      tags: wf.tags,
      input_schema: wf.input_schema,
      tool_names: wf.activity_manifest
        .filter((a: any) => a.type === 'worker' && a.mcp_tool_name)
        .map((a: any) => a.mcp_tool_name),
      fts_rank: (wf as any).fts_rank || 0,
    });
  }

  return { inventory: inventoryLines.join('\n'), toolIds, candidates };
}

/**
 * Phase 2: LLM-as-judge evaluates whether any discovered workflow
 * matches the user's intent. One cheap call (mini model, ~200 tokens)
 * to potentially skip the entire agentic loop.
 */
export async function evaluateWorkflowMatch(
  prompt: string,
  candidates: WorkflowCandidate[],
): Promise<{ matched: boolean; workflowName: string | null; confidence: number }> {
  loggerRegistry.debug(`[mcpQuery:evaluateWorkflowMatch] ${candidates.length} candidate(s)`);
  if (candidates.length === 0) {
    return { matched: false, workflowName: null, confidence: 0 };
  }

  const candidateText = candidates.map((c, i) =>
    `${i + 1}. **${c.name}** (category: ${c.category || 'general'})\n` +
    `   Description: ${c.description || 'N/A'}\n` +
    `   Original prompt: "${c.original_prompt || 'N/A'}"\n` +
    `   Tools: ${c.tool_names.join(', ')}\n` +
    `   Input: ${JSON.stringify(c.input_schema).slice(0, 300)}`
  ).join('\n\n');

  try {
    const response = await callLLMService({
      model: LLM_MODEL_SECONDARY,
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: 'system', content: WORKFLOW_MATCH_PROMPT },
        { role: 'user', content: `## User Request\n${prompt}\n\n## Candidate Workflows\n${candidateText}` },
      ],
    });

    const raw = response.content || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const result = JSON.parse(cleaned);

    if (result.match && result.confidence >= 0.7) {
      loggerRegistry.info(`[mcpQuery:evaluateWorkflowMatch] MATCHED: ${result.workflow_name} (confidence: ${result.confidence})`);
      return { matched: true, workflowName: result.workflow_name, confidence: result.confidence };
    }
    loggerRegistry.info(`[mcpQuery:evaluateWorkflowMatch] no match (confidence: ${result.confidence || 0})`);
    return { matched: false, workflowName: null, confidence: result.confidence || 0 };
  } catch (err: any) {
    loggerRegistry.warn(`[mcpQuery:evaluateWorkflowMatch] error: ${err.message}`);
    return { matched: false, workflowName: null, confidence: 0 };
  }
}

/**
 * Phase 2b: Extract structured inputs from the user's prompt using the
 * matched workflow's input_schema. Acts as a second confirmation gate —
 * if the LLM can't map the prompt to the schema, the match is rejected.
 */
export async function extractWorkflowInputs(
  prompt: string,
  inputSchema: Record<string, unknown>,
  workflowName: string,
): Promise<{ inputs: Record<string, any> | null; extracted: boolean }> {
  try {
    const response = await callLLMService({
      model: LLM_MODEL_SECONDARY,
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: EXTRACT_INPUTS_PROMPT },
        {
          role: 'user',
          content:
            `## User Request\n${prompt}\n\n` +
            `## Workflow: ${workflowName}\n` +
            `## Input Schema\n${JSON.stringify(inputSchema, null, 2)}`,
        },
      ],
    });

    const raw = response.content || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const result = JSON.parse(cleaned);

    if (result._extraction_failed) {
      return { inputs: null, extracted: false };
    }

    // Remove the meta field before passing to the workflow
    delete result._extraction_failed;
    return { inputs: result, extracted: true };
  } catch {
    return { inputs: null, extracted: false };
  }
}
