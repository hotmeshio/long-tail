import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import OpenAI from 'openai';

import { LLM_MODEL_SECONDARY, LLM_MAX_TOKENS_VISION } from '../../modules/defaults';
import { loggerRegistry } from '../../services/logger';
import * as verifyActivities from '../../examples/workflows/verify-document/activities';

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

const extractMemberInfoSchema = z.object({
  image_ref: z.string().describe('Storage reference to the document page image'),
  page_number: z.number().int().min(1).describe('1-based page number'),
});

const rotatePageSchema = z.object({
  image_ref: z.string().describe('Storage reference to the image to rotate'),
  degrees: z.number().int().describe('Rotation degrees (90, 180, 270)'),
});

const translateContentSchema = z.object({
  content: z.string().describe('The content text to translate'),
  target_language: z.string().describe('Target language code (e.g. "en", "es")'),
});

const validateMemberSchema = z.object({
  member_info: z.object({
    memberId: z.string().optional(),
    name: z.string().optional(),
    address: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
    }).optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    emergencyContact: z.object({
      name: z.string(),
      phone: z.string(),
    }).optional(),
    isPartialInfo: z.boolean().optional(),
  }).describe('Extracted member information to validate against the member database'),
});

/**
 * Register all five vision tools on an McpServer instance.
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
      const pages = await verifyActivities.listDocumentPages();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ pages }) }],
      };
    },
  );

  // ── extract_member_info ─────────────────────────────────────────
  (srv as any).registerTool(
    'extract_member_info',
    {
      title: 'Extract Member Info',
      description: 'Extract member information from a document page image using OpenAI Vision (gpt-4o-mini). Returns structured MemberInfo or null if the image is unreadable (e.g. upside down or blurry).',
      inputSchema: extractMemberInfoSchema,
    },
    async (args: z.infer<typeof extractMemberInfoSchema>) => {
      const info = await verifyActivities.extractMemberInfo(
        args.image_ref,
        args.page_number,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ member_info: info }) }],
      };
    },
  );

  // ── validate_member ─────────────────────────────────────────────
  (srv as any).registerTool(
    'validate_member',
    {
      title: 'Validate Member',
      description: 'Validate extracted member information against the member database. Returns match, mismatch, or not_found with optional database record.',
      inputSchema: validateMemberSchema,
    },
    async (args: z.infer<typeof validateMemberSchema>) => {
      const result = await verifyActivities.validateMember(args.member_info);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
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

      loggerRegistry.info(
        `[lt-mcp:vision-server] rotated ${args.image_ref} by ${args.degrees}° → ${rotatedName}`,
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            rotated_ref: rotatedName,
            degrees: args.degrees,
            source_ref: args.image_ref,
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
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey || apiKey === 'xxx') {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              translated_content: args.content,
              source_language: 'unknown',
              target_language: args.target_language,
              note: 'OPENAI_API_KEY not configured — returned content unchanged',
            }),
          }],
        };
      }

      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: LLM_MODEL_SECONDARY,
        messages: [
          {
            role: 'system',
            content: `You are a translation assistant. Translate the user's text to ${args.target_language}. Return ONLY a JSON object: {"translated_content": "...", "source_language": "detected ISO code"}. No markdown, no explanation.`,
          },
          { role: 'user', content: args.content },
        ],
        max_tokens: LLM_MAX_TOKENS_VISION,
      });

      const raw = response.choices?.[0]?.message?.content || '';
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
  loggerRegistry.info(`[lt-mcp:vision-server] ${name} ready (5 tools registered)`);
  return instance;
}

/**
 * Stop a Vision MCP server instance and release resources.
 */
export async function stopVisionServer(): Promise<void> {
  // No-op — instances are now independent and cleaned up by their callers
  loggerRegistry.info('[lt-mcp:vision-server] stopped');
}
