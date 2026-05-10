/**
 * Externalized LLM prompt constants for the yaml-workflow pipeline.
 *
 * Template strings live in prompt-templates.ts. This file re-exports them
 * and provides builder functions that compose prompts at runtime.
 */

// Re-export all prompt template constants
export {
  COMPILATION_PROMPT,
  VALIDATION_PROMPT,
  EXTRACT_DEFAULT_SYSTEM_PROMPT,
  EXTRACT_DEFAULT_USER_TEMPLATE,
} from './prompt-templates';

// ── Recompilation hint (compile stage retry) ──────────────────────────────────

/**
 * Build the retry hint injected into the compile stage when
 * user feedback or a prior deployment error triggers recompilation.
 */
export function buildRecompilationHint(feedback: string, priorYaml?: string): string {
  return [
    `\n## RECOMPILATION — User Feedback`,
    `The user reviewed the compiled output and provided this feedback:`,
    `> ${feedback}`,
    ``,
    `You MUST produce a plan that addresses this feedback. Key rules:`,
    `- Complex tool arguments (steps arrays, script strings, selector objects) are ALWAYS fixed — never dynamic inputs.`,
    `- Only simple scalar values (URLs, credentials, file paths) should be dynamic trigger inputs.`,
    `- If the feedback says certain fields should not be inputs, classify them as "fixed" with their default values from the execution trace.`,
    `- If the feedback mentions input key mismatches, ensure dataFlow edges use the exact field names each tool expects.`,
    `- Session fields (_handle, page_id) must be threaded through ALL subsequent steps via dataFlow edges.`,
    ...(priorYaml ? [
      ``,
      `### Previous YAML (to improve upon)`,
      '```yaml',
      priorYaml.slice(0, 2000),
      '```',
    ] : []),
  ].join('\n');
}
