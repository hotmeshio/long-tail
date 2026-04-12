import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callLLM } from '../../services/llm';
import { LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_VISION } from '../../modules/defaults';
import { loggerRegistry } from '../../services/logger';
import { ANALYZE_IMAGE_PROMPT, DESCRIBE_IMAGE_PROMPT } from './vision-prompts';

const analyzeImageSchema = z.object({
  image: z.string().describe('Image URL or data URI (e.g. https://... or data:image/png;base64,...)'),
  prompt: z.string().optional().describe('Optional analysis prompt to guide the model'),
});

const describeImageSchema = z.object({
  image: z.string().describe('Image URL or data URI'),
  context: z.string().optional().describe('Optional context about the image'),
});

function buildImageContent(image: string): { type: 'image'; source: { type: string; media_type?: string; url?: string; data?: string } } {
  if (image.startsWith('data:')) {
    const match = image.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) {
      return {
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] },
      };
    }
  }
  return {
    type: 'image',
    source: { type: 'url', url: image },
  };
}

function registerTools(srv: McpServer): void {
  // ── analyze_image ───────────────────────────────────────────────
  (srv as any).registerTool(
    'analyze_image',
    {
      title: 'Analyze Image',
      description: 'Analyze an image and extract structured data: description, text content, and notable objects.',
      inputSchema: analyzeImageSchema,
    },
    async (args: z.infer<typeof analyzeImageSchema>) => {
      const { hasLLMApiKey } = await import('../../services/llm');
      if (!hasLLMApiKey(LLM_MODEL_SECONDARY)) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'LLM API key not configured',
              description: null,
              text_content: null,
              objects: [],
            }),
          }],
        };
      }

      const systemPrompt = args.prompt
        ? `${ANALYZE_IMAGE_PROMPT}\n\nAdditional guidance: ${args.prompt}`
        : ANALYZE_IMAGE_PROMPT;

      const response = await callLLM({
        model: LLM_MODEL_SECONDARY,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [buildImageContent(args.image) as any],
          },
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
              description: parsed.description || null,
              text_content: parsed.text_content || null,
              objects: parsed.objects || [],
            }),
          }],
        };
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              description: raw,
              text_content: null,
              objects: [],
            }),
          }],
        };
      }
    },
  );

  // ── describe_image ──────────────────────────────────────────────
  (srv as any).registerTool(
    'describe_image',
    {
      title: 'Describe Image',
      description: 'Generate a detailed description of an image.',
      inputSchema: describeImageSchema,
    },
    async (args: z.infer<typeof describeImageSchema>) => {
      const { hasLLMApiKey } = await import('../../services/llm');
      if (!hasLLMApiKey(LLM_MODEL_SECONDARY)) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'LLM API key not configured',
              description: null,
            }),
          }],
        };
      }

      const systemPrompt = args.context
        ? `${DESCRIBE_IMAGE_PROMPT}\n\nContext: ${args.context}`
        : DESCRIBE_IMAGE_PROMPT;

      const response = await callLLM({
        model: LLM_MODEL_SECONDARY,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [buildImageContent(args.image) as any],
          },
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
            text: JSON.stringify({ description: parsed.description || raw }),
          }],
        };
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ description: raw }),
          }],
        };
      }
    },
  );
}

/**
 * Create the Vision MCP server.
 *
 * Returns a fresh McpServer instance each time. The MCP SDK only allows
 * one transport per server, so each consumer needs its own instance.
 */
export async function createVisionServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-vision';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:vision] ${name} ready (2 tools registered)`);
  return instance;
}

/**
 * Stop a Vision MCP server instance.
 */
export async function stopVisionServer(): Promise<void> {
  loggerRegistry.info('[lt-mcp:vision] stopped');
}
