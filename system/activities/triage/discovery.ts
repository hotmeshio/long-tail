import { callLLM as callLLMService } from '../../../services/llm';
import { LLM_MODEL_SECONDARY, STOP_WORDS } from '../../../modules/defaults';
import { WORKFLOW_MATCH_PROMPT, EXTRACT_INPUTS_PROMPT } from '../../workflows/mcp-query/prompts';
import { loggerRegistry } from '../../../services/logger';
import * as yamlDb from '../../../services/yaml-workflow/db';
import { yamlWorkflowMap, toolDefCache } from './cache';

/** Candidate workflow returned by ranked discovery. */
export interface WorkflowCandidate {
  name: string;
  description: string | null;
  original_prompt: string | null;
  category: string | null;
  tags: string[];
  input_schema: Record<string, unknown>;
  tool_names: string[];
  fts_rank: number;
}

/**
 * Search for active compiled YAML workflows matching a text query.
 * Uses PostgreSQL FTS + tag overlap for ranked matching.
 */
export async function findTriageWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  toolIds: string[];
  candidates: WorkflowCandidate[];
}> {
  loggerRegistry.debug(`[mcpTriage:findTriageWorkflows] searching: ${prompt.slice(0, 60)}`);
  const keywords = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  loggerRegistry.debug(`[mcpTriage:findTriageWorkflows] keywords: [${keywords.join(',')}]`);

  let workflows: Awaited<ReturnType<typeof yamlDb.discoverWorkflows>>;
  try {
    workflows = await yamlDb.discoverWorkflows(prompt, keywords, undefined, 5);
    loggerRegistry.info(`[mcpTriage:findTriageWorkflows] ${workflows.length} candidate(s) found`);
  } catch (err: any) {
    loggerRegistry.warn(`[mcpTriage:findTriageWorkflows] discovery failed: ${err.message}`);
    return { inventory: '', toolIds: [], candidates: [] };
  }

  if (workflows.length === 0) {
    loggerRegistry.debug(`[mcpTriage:findTriageWorkflows] no candidates found`);
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

// ── Compiled workflow matching (reused by mcpTriageRouter) ────

/**
 * LLM-as-judge: does a compiled workflow match the triage context?
 */
export async function evaluateTriageMatch(
  prompt: string,
  candidates: WorkflowCandidate[],
): Promise<{ matched: boolean; workflowName: string | null; confidence: number }> {
  loggerRegistry.debug(`[mcpTriage:evaluateTriageMatch] ${candidates.length} candidate(s)`);
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
      return { matched: true, workflowName: result.workflow_name, confidence: result.confidence };
    }
    return { matched: false, workflowName: null, confidence: result.confidence || 0 };
  } catch {
    return { matched: false, workflowName: null, confidence: 0 };
  }
}

/**
 * Extract structured inputs from the triage context using a workflow's input schema.
 */
export async function extractTriageInputs(
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
    delete result._extraction_failed;
    return { inputs: result, extracted: true };
  } catch {
    return { inputs: null, extracted: false };
  }
}
