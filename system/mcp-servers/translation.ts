import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callLLM } from '../../services/llm';
import { LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_VISION } from '../../modules/defaults';
import { loggerRegistry } from '../../services/logger';

function TRANSLATE_SYSTEM_PROMPT(targetLanguage: string): string {
  return `You are a translation assistant. Translate the user's text to ${targetLanguage}. Return ONLY a JSON object: {"translated_content": "...", "source_language": "detected ISO code"}. No markdown, no explanation.`;
}

const translateContentSchema = z.object({
  content: z.string().describe('The content text to translate'),
  target_language: z.string().describe('Target language code (e.g. "en", "es")'),
  source_language: z.string().optional().describe('Source language code (auto-detected if omitted)'),
});

function registerTools(srv: McpServer): void {
  (srv as any).registerTool(
    'translate_content',
    {
      title: 'Translate Content',
      description: 'Translate content text to the target language. Returns the translated content and detected source language.',
      inputSchema: translateContentSchema,
    },
    async (args: z.infer<typeof translateContentSchema>) => {
      const { hasLLMApiKey } = await import('../../services/llm');
      if (!hasLLMApiKey(LLM_MODEL_SECONDARY)) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              translated_content: args.content,
              source_language: args.source_language || 'unknown',
              target_language: args.target_language,
              note: 'LLM API key not configured — returned content unchanged',
            }),
          }],
        };
      }

      const systemPrompt = args.source_language
        ? `You are a translation assistant. Translate the user's text from ${args.source_language} to ${args.target_language}. Return ONLY a JSON object: {"translated_content": "...", "source_language": "${args.source_language}"}. No markdown, no explanation.`
        : TRANSLATE_SYSTEM_PROMPT(args.target_language);

      const response = await callLLM({
        model: LLM_MODEL_SECONDARY,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: args.content },
        ],
        max_tokens: LLM_MAX_TOKENS_VISION,
        temperature: 0,
      });

      const raw = response.content || '';
      try {
        const cleaned = raw.replace(/^```json\n?|\n?```$/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              translated_content: parsed.translated_content || args.content,
              source_language: parsed.source_language || args.source_language || 'unknown',
              target_language: args.target_language,
            }),
          }],
        };
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              translated_content: raw,
              source_language: args.source_language || 'unknown',
              target_language: args.target_language,
            }),
          }],
        };
      }
    },
  );
}

/**
 * Create the Translation MCP server.
 *
 * Returns a fresh McpServer instance each time. The MCP SDK only allows
 * one transport per server, so each consumer needs its own instance.
 */
export async function createTranslationServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-translation';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:translation] ${name} ready (1 tool registered)`);
  return instance;
}

/**
 * Stop a Translation MCP server instance.
 */
export async function stopTranslationServer(): Promise<void> {
  loggerRegistry.info('[lt-mcp:translation] stopped');
}
