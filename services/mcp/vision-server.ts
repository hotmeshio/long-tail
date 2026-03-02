import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../logger';
import * as verifyActivities from '../../examples/workflows/verify-document/activities';

let server: McpServer | null = null;

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
 * Create the Document Vision MCP server.
 *
 * Registers five tools wrapping the verify-document activities:
 * - list_document_pages — list available page images from storage
 * - extract_member_info — extract member data from a page via OpenAI Vision
 * - validate_member — validate extracted data against the member database
 * - rotate_page — rotate a document page image by the given degrees
 * - translate_content — translate text content to a target language
 */
export async function createVisionServer(options?: {
  name?: string;
}): Promise<McpServer> {
  if (server) return server;

  const name = options?.name || 'long-tail-document-vision';
  server = new McpServer({ name, version: '1.0.0' });

  // ── list_document_pages ─────────────────────────────────────────
  (server as any).registerTool(
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
  (server as any).registerTool(
    'extract_member_info',
    {
      title: 'Extract Member Info',
      description: 'Extract member information from a document page image using OpenAI Vision (gpt-4o-mini). Returns structured MemberInfo or null.',
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
  (server as any).registerTool(
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
  (server as any).registerTool(
    'rotate_page',
    {
      title: 'Rotate Page',
      description: 'Rotate a document page image by the given degrees. Returns a new image reference for the rotated version.',
      inputSchema: rotatePageSchema,
    },
    async (args: z.infer<typeof rotatePageSchema>) => {
      // Derive rotated reference by inserting _rotated before the extension.
      // In production, this would call an image processing service.
      const ref = args.image_ref;
      const dotIdx = ref.lastIndexOf('.');
      const rotatedRef = dotIdx >= 0
        ? `${ref.slice(0, dotIdx)}_rotated${ref.slice(dotIdx)}`
        : `${ref}_rotated`;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ rotated_ref: rotatedRef, degrees: args.degrees }),
        }],
      };
    },
  );

  // ── translate_content ──────────────────────────────────────────
  (server as any).registerTool(
    'translate_content',
    {
      title: 'Translate Content',
      description: 'Translate content text to the target language. Returns the translated content and detected source language.',
      inputSchema: translateContentSchema,
    },
    async (args: z.infer<typeof translateContentSchema>) => {
      // For the demo, strip the WRONG_LANGUAGE marker and return the English text.
      // In production this would call a translation API.
      const cleaned = args.content
        .replace(/WRONG_LANGUAGE\s*/g, '')
        .trim();

      // Simulate: the cleaned text IS the English translation
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            translated_content: cleaned,
            source_language: 'es',
            target_language: args.target_language,
          }),
        }],
      };
    },
  );

  loggerRegistry.info(`[lt-mcp:vision-server] ${name} ready (5 tools registered)`);
  return server;
}

/**
 * Get the current Vision MCP server instance.
 */
export function getVisionServer(): McpServer | null {
  return server;
}

/**
 * Stop the Vision MCP server and release resources.
 */
export async function stopVisionServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:vision-server] stopped');
  }
}
