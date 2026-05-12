import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../lib/logger';
import { getFreshAccessToken } from '../../services/oauth';
import * as gmail from '../activities/gmail';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the Google access token from _scope or explicit user_id. */
async function resolveGoogleToken(args: Record<string, any>): Promise<string> {
  // Prefer explicit user_id (direct API call pattern)
  const userId = args.user_id || args._scope?.principal?.id;
  if (!userId) {
    throw new Error('No user identity available. Pass user_id or ensure _scope is set.');
  }
  const token = await getFreshAccessToken(userId, 'google');
  return token.accessToken;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().describe('Gmail search query (same syntax as the Gmail search bar)'),
  maxResults: z.number().optional().default(10).describe('Max messages to return (default: 10, max: 50)'),
  _scope: z.any().optional(),
  user_id: z.string().optional().describe('User ID (auto-resolved from workflow context if omitted)'),
});

const readSchema = z.object({
  messageId: z.string().describe('Gmail message ID (from gmail_search results)'),
  _scope: z.any().optional(),
  user_id: z.string().optional(),
});

const summarizeSchema = z.object({
  threadId: z.string().describe('Gmail thread ID (from gmail_search results)'),
  _scope: z.any().optional(),
  user_id: z.string().optional(),
});

const extractSchema = z.object({
  messageId: z.string().describe('Gmail message ID'),
  fields: z.array(z.string()).optional().describe('Fields to extract (e.g., ["account_number", "amount"])'),
  _scope: z.any().optional(),
  user_id: z.string().optional(),
});

const draftSchema = z.object({
  to: z.string().describe('Recipient email address'),
  subject: z.string().describe('Email subject line'),
  body: z.string().describe('Email body (plain text)'),
  threadId: z.string().optional().describe('Thread ID to reply to (creates a reply draft)'),
  _scope: z.any().optional(),
  user_id: z.string().optional(),
});

// ── Server Factory ──────────────────────────────────────────────────────────

export async function createGmailServer(): Promise<McpServer> {
  const instance = new McpServer({ name: 'long-tail-gmail', version: '1.0.0' });

  (instance as any).registerTool(
    'gmail_search',
    {
      title: 'Search Gmail',
      description: 'Search inbox for messages matching a query. Returns message IDs, snippets, from, subject, and date.',
      inputSchema: searchSchema,
    },
    async (args: z.infer<typeof searchSchema>) => {
      try {
        const token = await resolveGoogleToken(args);
        const result = await gmail.searchMessages(token, args.query, args.maxResults);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        loggerRegistry.error(`[gmail] search failed: ${err.message}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'gmail_read',
    {
      title: 'Read Gmail Message',
      description: 'Read the full content of a message by ID. Returns headers and decoded body text.',
      inputSchema: readSchema,
    },
    async (args: z.infer<typeof readSchema>) => {
      try {
        const token = await resolveGoogleToken(args);
        const result = await gmail.readMessage(token, args.messageId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        loggerRegistry.error(`[gmail] read failed: ${err.message}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'gmail_summarize',
    {
      title: 'Summarize Gmail Thread',
      description: 'Fetch all messages in a thread. Returns concatenated content for LLM summarization.',
      inputSchema: summarizeSchema,
    },
    async (args: z.infer<typeof summarizeSchema>) => {
      try {
        const token = await resolveGoogleToken(args);
        const result = await gmail.getThread(token, args.threadId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        loggerRegistry.error(`[gmail] summarize failed: ${err.message}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'gmail_extract',
    {
      title: 'Extract Data from Gmail Message',
      description: 'Read a message and return content with parsed headers for structured extraction.',
      inputSchema: extractSchema,
    },
    async (args: z.infer<typeof extractSchema>) => {
      try {
        const token = await resolveGoogleToken(args);
        const message = await gmail.readMessage(token, args.messageId);
        const result = {
          ...message,
          requestedFields: args.fields || null,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        loggerRegistry.error(`[gmail] extract failed: ${err.message}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'gmail_draft',
    {
      title: 'Create Gmail Draft',
      description: 'Create a draft email. The draft appears in Drafts and can be reviewed before sending.',
      inputSchema: draftSchema,
    },
    async (args: z.infer<typeof draftSchema>) => {
      try {
        const token = await resolveGoogleToken(args);
        const result = await gmail.createDraft(token, args.to, args.subject, args.body, args.threadId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        loggerRegistry.error(`[gmail] draft failed: ${err.message}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  return instance;
}
