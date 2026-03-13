// ── Document Vision prompts ─────────────────────────────────────────────────

/**
 * Build the translation system prompt for the given target language.
 */
export function TRANSLATE_SYSTEM_PROMPT(targetLanguage: string): string {
  return `You are a translation assistant. Translate the user's text to ${targetLanguage}. Return ONLY a JSON object: {"translated_content": "...", "source_language": "detected ISO code"}. No markdown, no explanation.`;
}
