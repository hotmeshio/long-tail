import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callLLM } from '../../services/llm';
import { LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_VISION } from '../../modules/defaults';
import { loggerRegistry } from '../../services/logger';
import { TRANSLATE_SYSTEM_PROMPT } from './prompts';

// ── Resolve fixtures directory ──────────────────────────────────────────────
function fixturesDir(): string {
  // Works from both ts-node (root) and compiled (build/) contexts
  const candidates = [
    path.join(__dirname, '..', '..', 'tests', 'fixtures'),
    path.join(__dirname, '..', '..', '..', 'tests', 'fixtures'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

// ── Schemas (extracted to break TS2589 deep-instantiation in registerTool generics) ──

const listDocumentPagesSchema = z.object({});

const rotatePageSchema = z.object({
  image_ref: z.string().describe('Storage reference to the image to rotate'),
  degrees: z.number().int().describe('Rotation degrees (90, 180, 270)'),
  replace_original: z.boolean().optional().default(true).describe('Delete the original file after rotation (default: true)'),
});

const translateContentSchema = z.object({
  content: z.string().describe('The content text to translate'),
  target_language: z.string().describe('Target language code (e.g. "en", "es")'),
});

/**
 * List available document page images from storage.
 */
async function listDocumentPages(): Promise<string[]> {
  const dir = fixturesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
}

/**
 * Register all three vision tools on an McpServer instance.
 */
function registerTools(srv: McpServer): void {
  // ── list_document_pages ─────────────────────────────────────────
  (srv as any).registerTool(
    'list_document_pages',
    {
      title: 'List Document Pages',
      description: 'List available document page images from storage. Returns an array of image references.',
      inputSchema: listDocumentPagesSchema,
    },
    async (_args: z.infer<typeof listDocumentPagesSchema>) => {
      const pages = await listDocumentPages();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ pages }) }],
      };
    },
  );

  // ── rotate_page ───────────────────────────────────────────────
  (srv as any).registerTool(
    'rotate_page',
    {
      title: 'Rotate Page',
      description: 'Rotate a document page image by the given degrees using sharp. Writes the corrected image to storage and returns the new image reference.',
      inputSchema: rotatePageSchema,
    },
    async (args: z.infer<typeof rotatePageSchema>) => {
      const dir = fixturesDir();
      const srcPath = path.join(dir, args.image_ref);

      if (!fs.existsSync(srcPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Image not found: ${args.image_ref}` }),
          }],
        };
      }

      // Build output filename: page1_upside_down.png → page1_upside_down_rotated.png
      const ext = path.extname(args.image_ref);
      const base = path.basename(args.image_ref, ext);
      const rotatedName = `${base}_rotated${ext}`;
      const destPath = path.join(dir, rotatedName);

      await sharp(srcPath)
        .rotate(args.degrees)
        .toFile(destPath);

      // Clean up original if requested (default: true)
      if (args.replace_original !== false) {
        try {
          fs.unlinkSync(srcPath);
          loggerRegistry.info(
            `[lt-mcp:vision-server] rotated ${args.image_ref} by ${args.degrees}° → ${rotatedName} (original deleted)`,
          );
        } catch (err) {
          loggerRegistry.warn(
            `[lt-mcp:vision-server] rotated ${args.image_ref} but failed to delete original: ${err}`,
          );
        }
      } else {
        loggerRegistry.info(
          `[lt-mcp:vision-server] rotated ${args.image_ref} by ${args.degrees}° → ${rotatedName}`,
        );
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            rotated_ref: rotatedName,
            degrees: args.degrees,
            source_ref: args.image_ref,
            original_deleted: args.replace_original !== false,
          }),
        }],
      };
    },
  );

  // ── translate_content ──────────────────────────────────────────
  (srv as any).registerTool(
    'translate_content',
    {
      title: 'Translate Content',
      description: 'Translate content text to the target language using OpenAI. Returns the translated content and detected source language.',
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
              source_language: 'unknown',
              target_language: args.target_language,
              note: 'LLM API key not configured — returned content unchanged',
            }),
          }],
        };
      }

      const response = await callLLM({
        model: LLM_MODEL_SECONDARY,
        messages: [
          {
            role: 'system',
            content: TRANSLATE_SYSTEM_PROMPT(args.target_language),
          },
          { role: 'user', content: args.content },
        ],
        max_tokens: LLM_MAX_TOKENS_VISION,
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
              source_language: parsed.source_language || 'unknown',
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
              source_language: 'unknown',
              target_language: args.target_language,
            }),
          }],
        };
      }
    },
  );
}

/**
 * Create the Document Vision MCP server.
 *
 * Returns a fresh McpServer instance each time. The MCP SDK only allows
 * one transport per server, so each consumer (triage activities, pipeline
 * workers, tests) needs its own instance to avoid "already connected" errors.
 */
export async function createVisionServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-document-vision';
  const instance = new McpServer({ name, version: '1.0.0' });
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:vision-server] ${name} ready (3 tools registered)`);
  return instance;
}

/**
 * Stop a Vision MCP server instance and release resources.
 */
export async function stopVisionServer(): Promise<void> {
  // No-op — instances are now independent and cleaned up by their callers
  loggerRegistry.info('[lt-mcp:vision-server] stopped');
}
