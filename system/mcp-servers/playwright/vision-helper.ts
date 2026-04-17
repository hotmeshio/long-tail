/**
 * Shared vision analysis helper for playwright tools.
 *
 * Reads a screenshot from the storage backend and analyzes it
 * via the secondary vision LLM. Used by both the standalone
 * screenshot tool and run_script's screenshot steps.
 */

import * as path from 'path';

import { getStorageBackend } from '../../../lib/storage';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

/**
 * Read a screenshot from storage and analyze it via the vision LLM.
 * Returns the raw LLM text response (typically JSON with description, objects, etc.).
 */
export async function analyzeScreenshot(storagePath: string): Promise<string> {
  const { callLLM, hasLLMApiKey } = await import('../../../services/llm');
  const { LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_VISION } = await import('../../../modules/defaults');
  const { ANALYZE_IMAGE_PROMPT } = await import('../vision-prompts');

  if (!hasLLMApiKey(LLM_MODEL_SECONDARY)) {
    return 'Vision LLM not configured — set an API key to enable screenshot analysis.';
  }

  const backend = getStorageBackend();
  const { data } = await backend.read(storagePath);
  const base64 = data.toString('base64');
  const ext = path.extname(storagePath).toLowerCase();
  const mime = MIME_MAP[ext] || 'image/png';

  const response = await callLLM({
    model: LLM_MODEL_SECONDARY,
    messages: [
      { role: 'system', content: ANALYZE_IMAGE_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: LLM_MAX_TOKENS_VISION,
    temperature: 0,
  });

  return response.content || 'No description generated.';
}
