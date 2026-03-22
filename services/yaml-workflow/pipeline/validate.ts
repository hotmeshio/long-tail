/**
 * Validate stage: optional LLM review of generated YAML against intent.
 *
 * Checks for missing data flow connections, broken iteration sources,
 * and session handles that get lost mid-pipeline. Records issues as
 * informational warnings — does NOT modify the YAML.
 */

import { callLLM, hasLLMApiKey } from '../../llm';
import { LLM_MODEL_SECONDARY } from '../../../modules/defaults';
import type { PipelineContext } from './types';

const VALIDATION_PROMPT = `You are a YAML workflow validator. Given a workflow intent, activity manifest, and generated YAML DAG, identify data flow issues.

Check for:
1. Missing input wiring: a step needs data but no prior step provides it and it's not in the trigger
2. Broken iteration sources: a cycle references an array field that doesn't exist in the source step's output
3. Lost session handles: a session field (page_id, _handle) is produced by an early step (e.g., login) but not threaded to later browser/page steps that need it — including steps inside iteration loops
4. Unparameterized hardcoded values: URLs, credentials, or paths that should be dynamic inputs but are baked in
5. Iteration array source: verify the referenced items field in a cycle hook actually exists in the source activity's output fields
6. Trigger completeness: every dynamic input in the trigger schema should be referenced by at least one activity's input maps

Return a JSON object:
{
  "issues": ["description of issue 1", "description of issue 2"],
  "valid": true
}

If no issues, return { "issues": [], "valid": true }.
Be concise. Only report real problems, not style suggestions.`;

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
        inputs: Object.keys(a.input_mappings),
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
      const { loggerRegistry } = await import('../../logger');
      loggerRegistry.warn(`[yaml-workflow] Validation issues found: ${parsed.issues.join('; ')}`);
    }
  } catch (err) {
    const { loggerRegistry } = await import('../../logger');
    loggerRegistry.info(`[yaml-workflow] Validation skipped: ${err}`);
  }

  return ctx;
}
