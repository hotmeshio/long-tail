/**
 * Label template and label sheet tools — mirrors routes/labels.ts
 *
 * render_label_sheet issues a sheet as the caller and stores it as a file
 * with a short-lived link. It prints item labels only: identity templates
 * (badges) are printed by people, with a confirmation, never by an agent.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as labelsApi from '../../../api/labels';
import { getLabelTemplate } from '../../../services/labels';
import { getScanScheme } from '../../../services/scan-code';
import { getStorageBackend } from '../../../lib/storage';
import { SCAN_SCHEME_KINDS } from '../../../types';
import type { LabelSource } from '../../../types/labels';
import { callerAuth, type ToolCallExtra } from '../caller-auth';
import {
  deleteLabelTemplateSchema,
  listLabelTemplatesSchema,
  renderLabelSheetSchema,
  upsertLabelTemplateSchema,
} from './labels-schemas';

const SIGNED_URL_SECONDS = 600;

function asText(payload: unknown, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

export function registerLabelTools(server: McpServer): void {

  // mirrors GET /api/labels/templates
  (server as any).registerTool(
    'list_label_templates',
    {
      title: 'List Label Templates',
      description: 'List label templates: which scan scheme each prints, its codes with captions, text, symbology and default media.',
      inputSchema: listLabelTemplatesSchema,
    },
    async (args: z.infer<typeof listLabelTemplatesSchema>) => {
      const result = await labelsApi.listLabelTemplates({ scheme: args.scheme });
      return asText(result.data ?? { error: result.error }, !!result.error);
    },
  );

  // mirrors PUT /api/labels/templates/:name
  (server as any).registerTool(
    'upsert_label_template',
    {
      title: 'Upsert Label Template',
      description:
        'Create or replace a label template for a scan scheme: 1-4 of the scheme\'s rules printed as codes, ' +
        'each beside its caption in a solid, outline or plain band; a title and up to two lines in label tokens.',
      inputSchema: upsertLabelTemplateSchema,
    },
    async (args: z.infer<typeof upsertLabelTemplateSchema>) => {
      const result = await labelsApi.upsertLabelTemplate(args);
      return asText(result.data ?? { error: result.error }, !!result.error);
    },
  );

  // mirrors DELETE /api/labels/templates/:name
  (server as any).registerTool(
    'delete_label_template',
    { title: 'Delete Label Template', description: 'Delete one label template by name.', inputSchema: deleteLabelTemplateSchema },
    async (args: z.infer<typeof deleteLabelTemplateSchema>) => {
      const result = await labelsApi.deleteLabelTemplate(args);
      return asText(result.data ?? { error: result.error }, !!result.error);
    },
  );

  // mirrors POST /api/labels/issue (item templates only)
  (server as any).registerTool(
    'render_label_sheet',
    {
      title: 'Render Label Sheet',
      description:
        'Issue a sheet of item labels as the caller and store it as a PDF (sheet stock) or ZPL (thermal) file. ' +
        'Returns the job id, the file ref, a link valid for 10 minutes, and warnings for codes that would fail on the floor. ' +
        'Badge (identity) templates are refused: people print badges.',
      inputSchema: renderLabelSheetSchema,
    },
    async (args: z.infer<typeof renderLabelSheetSchema>, extra?: ToolCallExtra) => {
      const template = await getLabelTemplate(args.template);
      const scheme = template ? await getScanScheme(template.scheme_version) : null;
      if (template && (template.sensitive || scheme?.kind === SCAN_SCHEME_KINDS.IDENTITY)) {
        return asText({ error: `"${args.template}" prints credentials or sensitive labels; a person prints it from the dashboard` }, true);
      }
      const result = await labelsApi.issueLabels({
        template: args.template,
        source: args.source as LabelSource,
        layout: { media: args.media, startPosition: args.startPosition, copies: args.copies },
        output: args.format,
      }, await callerAuth(extra));
      if (result.error) return asText({ error: result.error }, true);
      const { job, warnings, pdf, zpl } = result.data;
      const key = `labels/${job.id}.${args.format}`;
      const storage = getStorageBackend();
      const { ref } = await storage.write(key, Buffer.from(args.format === 'pdf' ? pdf : zpl));
      const url = await storage.getSignedUrl(key, SIGNED_URL_SECONDS);
      return asText({ jobId: job.id, labelCount: job.label_count, ref, url, warnings });
    },
  );
}
