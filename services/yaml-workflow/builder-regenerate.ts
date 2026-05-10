/**
 * Regenerate a Plan Build workflow from its original prompt + compilation feedback.
 *
 * Reuses the builder's LLM call and prompt structure without spawning a full
 * durable workflow. This is the fast path for "Recompile Pipeline" on Plan Build
 * workflows that don't have an execution trace.
 */

import { callLLM } from '../llm';
import { LLM_MODEL_PRIMARY } from '../../modules/defaults';
import { loggerRegistry } from '../../lib/logger';

const BUILDER_MAX_TOKENS = 8192;

interface RebuildResult {
  yaml: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  activityManifest: unknown[];
  tags: string[];
}

/**
 * Rebuild a YAML workflow from a prompt with optional feedback on the prior attempt.
 */
export async function rebuildFromPrompt(options: {
  prompt: string;
  feedback?: string;
  priorYaml?: string;
  name: string;
  appId: string;
}): Promise<RebuildResult> {
  // Load the builder's system prompt and tool inventory
  const { loadBuilderTools } = await import('../../system/workflows/mcp-workflow-builder/activities');
  const { BUILDER_SYSTEM_PROMPT, REFINE_PROMPT } = await import('../../system/workflows/mcp-workflow-builder/prompts');

  const raw = await loadBuilderTools();
  const serverSection = [
    raw.strategy ? `${raw.strategy}\n` : '',
    `## Available MCP Servers & Tools\n\n${raw.inventory}`,
  ].filter(Boolean).join('\n');

  const messages: any[] = [
    { role: 'system', content: BUILDER_SYSTEM_PROMPT(serverSection) },
  ];

  if (options.feedback && options.priorYaml) {
    messages.push({ role: 'user', content: `Build a workflow for: ${options.prompt}` });
    messages.push({
      role: 'assistant',
      content: `Here is the prior YAML that needs fixing:\n\`\`\`yaml\n${options.priorYaml.slice(0, 3000)}\n\`\`\``,
    });
    messages.push({
      role: 'user',
      content: `${REFINE_PROMPT}\n\nExecution feedback:\n${options.feedback}`,
    });
  } else {
    messages.push({ role: 'user', content: `Build a workflow for: ${options.prompt}` });
  }

  // Call LLM with retry
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    const response = await callLLM({
      model: LLM_MODEL_PRIMARY,
      messages,
      temperature: 0,
      max_tokens: BUILDER_MAX_TOKENS,
    });

    loggerRegistry.info(
      `[builder-regenerate] attempt=${attempt + 1} ${Date.now() - t0}ms | in=${response.usage?.prompt_tokens} out=${response.usage?.completion_tokens}`,
    );

    const content = response.content || '';
    const cleaned = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');

    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed.yaml) throw new Error('Missing yaml in response');

      return {
        yaml: parsed.yaml,
        inputSchema: parsed.input_schema || {},
        outputSchema: parsed.output_schema || {},
        activityManifest: parsed.activity_manifest || [],
        tags: parsed.tags || [],
      };
    } catch (err: any) {
      loggerRegistry.warn(`[builder-regenerate] parse failed (attempt ${attempt + 1}): ${err.message}`);
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `Your response was not valid JSON. Return ONLY a JSON object with "yaml", "input_schema", "output_schema", "activity_manifest", and "tags" fields.`,
      });
    }
  }

  throw new Error('Failed to regenerate YAML after 3 attempts');
}
