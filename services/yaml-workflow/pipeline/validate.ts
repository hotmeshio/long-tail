/**
 * Validate stage: optional LLM review of generated YAML against intent.
 *
 * Checks for missing data flow connections, broken iteration sources,
 * and session handles that get lost mid-pipeline. Records issues as
 * informational warnings — does NOT modify the YAML.
 */

import { callLLM, hasLLMApiKey } from '../../llm';
import { LLM_MODEL_SECONDARY } from '../../../modules/defaults';
import type { PipelineContext } from '../types';
import { VALIDATION_PROMPT } from './prompts';

/**
 * Validate pipeline stage: optional LLM review.
 */
export async function validate(ctx: PipelineContext): Promise<PipelineContext> {
  ctx.validationIssues = [];

  // Skip if no API key or no plan (no point validating mechanical output)
  if (!hasLLMApiKey(LLM_MODEL_SECONDARY) || !ctx.compilationPlan) return ctx;

  // Skip if explicitly disabled
  if (process.env.LT_SKIP_YAML_VALIDATION === '1') return ctx;

  try {
    // Truncate YAML if very long
    const yamlPreview = ctx.yaml.length > 4000
      ? ctx.yaml.slice(0, 4000) + '\n... (truncated)'
      : ctx.yaml;

    // Include activity manifest for cross-referencing tool requirements
    const manifestSummary = ctx.activityManifest
      .filter(a => a.type === 'worker')
      .map(a => ({
        id: a.activity_id,
        tool: a.mcp_tool_name || a.title,
        server: a.mcp_server_id,
        inputs: Object.keys(a.input_mappings).filter(k => k !== 'workflowName' && k !== '_scope'),
        outputs: a.output_fields,
      }));

    const userMessage = [
      `## Intent`,
      ctx.compilationPlan.intent,
      ``,
      `## Activity Manifest`,
      JSON.stringify(manifestSummary, null, 2),
      ``,
      `## Generated YAML`,
      '```yaml',
      yamlPreview,
      '```',
    ].join('\n');

    const response = await callLLM({
      model: LLM_MODEL_SECONDARY,
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: VALIDATION_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const raw = response.content || '';
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```$/m, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed.issues) && parsed.issues.length > 0) {
      ctx.validationIssues = parsed.issues;
      const { loggerRegistry } = await import('../../../lib/logger');
      loggerRegistry.warn(`[yaml-workflow] Validation issues found: ${parsed.issues.join('; ')}`);
    }
  } catch (err) {
    const { loggerRegistry } = await import('../../../lib/logger');
    loggerRegistry.info(`[yaml-workflow] Validation skipped: ${err}`);
  }

  return ctx;
}
