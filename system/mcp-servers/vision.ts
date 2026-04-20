import * as path from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import sharp from 'sharp';
import { callLLM } from '../../services/llm';
import { LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_VISION } from '../../modules/defaults';
import { loggerRegistry } from '../../lib/logger';
import { getStorageBackend } from '../../lib/storage';
import { ANALYZE_IMAGE_PROMPT, DESCRIBE_IMAGE_PROMPT } from './vision-prompts';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

/** Max dimension for LLM vision APIs (Anthropic limit is 8000px). */
const MAX_IMAGE_DIMENSION = 7680;

const analyzeImageSchema = z.object({
  image: z.string().describe(
    'Image source: a storage path (e.g. "amazon_initial.png"), ' +
    'a data URI (data:image/png;base64,...), or an https:// URL.',
  ),
  prompt: z.string().optional().describe('Optional analysis prompt to guide the model'),
});

const describeImageSchema = z.object({
  image: z.string().describe(
    'Image source: a storage path, data URI, or https:// URL.',
  ),
  context: z.string().optional().describe('Optional context about the image'),
});

/**
 * Resolve an image reference to an LLM-ready content block.
 *
 * Accepts:
 * - data:image/...;base64,... → used directly
 * - https:// URL → passed as-is (OpenAI can fetch; Anthropic translate layer handles)
 * - Storage path (anything else, including file:// prefixed) → read via storage backend
 */
async function resolveImageContent(
  image: string,
): Promise<{ type: 'image_url'; image_url: { url: string } }> {
  // Already a data URI — pass through
  if (image.startsWith('data:')) {
    return { type: 'image_url', image_url: { url: image } };
  }

  // HTTPS URL — pass through
  if (image.startsWith('https://') || image.startsWith('http://')) {
    return { type: 'image_url', image_url: { url: image } };
  }

  // Storage path — strip file:// prefix if present, read via backend
  const storagePath = image.replace(/^file:\/\//, '');
  const backend = getStorageBackend();
  const { data } = await backend.read(storagePath);

  // Downscale if any dimension exceeds the LLM vision limit
  let imageBuffer = data;
  let outputMime = MIME_MAP[path.extname(storagePath).toLowerCase()] || 'image/png';
  try {
    const meta = await sharp(data).metadata();
    if (meta.width && meta.height && (meta.width > MAX_IMAGE_DIMENSION || meta.height > MAX_IMAGE_DIMENSION)) {
      loggerRegistry.info(`[lt-mcp:vision] resizing ${meta.width}x${meta.height} -> fit ${MAX_IMAGE_DIMENSION}px`);
      imageBuffer = await sharp(data)
        .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: 'inside' })
        .png()
        .toBuffer();
      outputMime = 'image/png';
    }
  } catch (err: any) {
    loggerRegistry.warn(`[lt-mcp:vision] could not check/resize image: ${err.message}`);
  }

  const base64 = imageBuffer.toString('base64');
  return { type: 'image_url', image_url: { url: `data:${outputMime};base64,${base64}` } };
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

      let response;
      try {
        const imageContent = await resolveImageContent(args.image || (args as any).image_path);
        response = await callLLM({
          model: LLM_MODEL_SECONDARY,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [imageContent as any] },
          ],
          max_tokens: LLM_MAX_TOKENS_VISION,
          temperature: 0,
        });
      } catch (err: any) {
        loggerRegistry.error(`[lt-mcp:vision] analyze_image failed: ${err.message}`);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: err.message,
              description: null,
              text_content: null,
              objects: [],
            }),
          }],
        };
      }

      const raw = response.content || '';
      loggerRegistry.info(`[lt-mcp:vision] analyze_image response length: ${raw.length}`);
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
            content: [await resolveImageContent(args.image || (args as any).image_path) as any],
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
