/**
 * Scan-code tools — mirrors routes/scan-codes.ts
 *
 * Schemes map a code's leading two digits (10-99) to a target metadata facet
 * and parse shape; rules map a single-digit category (0-9) to ordered
 * condition/action steps over the escalation surface. execute_scan_code and
 * execute_scan_choice run as the `/mcp` caller, or as lt-system for internal calls.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as scanCodesApi from '../../../api/scan-codes';
import { callerAuth, type ToolCallExtra } from '../caller-auth';
import {
  executeScanCodeSchema,
  executeScanChoiceSchema,
  listScanSchemesSchema,
  upsertScanSchemeSchema,
  upsertScanRuleSchema,
  deleteScanRuleSchema,
} from './schemas';

function asText(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

export function registerScanCodeTools(server: McpServer): void {

  // mirrors POST /api/scan-codes/execute
  (server as any).registerTool(
    'execute_scan_code',
    {
      title: 'Execute Scan Code',
      description:
        'Execute a raw scan code (version:category:target, or a manufacturer barcode ' +
        'under a gtin scheme). Parses against the configured schemes, walks the ' +
        'rule\'s condition/action steps, and returns a structured outcome: executed, ' +
        'matched_list, confirm_required, choices, held (a subject to pass back as ' +
        '`subject` on the next scan), refused (nothing written; refusal names why), ' +
        'subject_stale, no_open_container, no_match_fallback, not_primed, ' +
        'identity_primed, identity_unknown, unconfigured, invalid_code, forbidden, conflict.',
      inputSchema: executeScanCodeSchema,
    },
    async (args: z.infer<typeof executeScanCodeSchema>, extra?: ToolCallExtra) => {
      const result = await scanCodesApi.executeScanCode({
        code: args.code,
        actingToken: args.actingToken,
        previousActingToken: args.previousActingToken,
        subject: args.subject,
        stationRole: args.stationRole,
      }, await callerAuth(extra));
      return asText(result.data ?? { error: result.error });
    },
  );

  // mirrors POST /api/scan-codes/execute-choice
  (server as any).registerTool(
    'execute_scan_choice',
    {
      title: 'Execute Scan Choice',
      description:
        'Execute one choice presented by a PRESENT step (the info-choice screen). ' +
        'The pointer (scheme/category/step/choice + escalationId) is re-validated ' +
        'against live config, the row\'s current state, the acting-identity gate, ' +
        'and RBAC before the verb runs.',
      inputSchema: executeScanChoiceSchema,
    },
    async (args: z.infer<typeof executeScanChoiceSchema>, extra?: ToolCallExtra) => {
      const result = await scanCodesApi.executeScanChoice(args, await callerAuth(extra));
      return asText(result.data ?? { error: result.error });
    },
  );

  // mirrors GET /api/scan-codes/schemes
  (server as any).registerTool(
    'list_scan_schemes',
    {
      title: 'List Scan Schemes',
      description: 'List all scan-code schemes (version, name, target facet, encoding).',
      inputSchema: listScanSchemesSchema,
    },
    async (_args: z.infer<typeof listScanSchemesSchema>) => {
      const result = await scanCodesApi.listScanSchemes();
      return asText(result.data ?? { error: result.error });
    },
  );

  // mirrors PUT /api/scan-codes/schemes/:version
  (server as any).registerTool(
    'upsert_scan_scheme',
    {
      title: 'Upsert Scan Scheme',
      description:
        'Create or replace a scan scheme: which metadata facet the scanned target ' +
        'resolves against and how the code string parses (fixed digits or delimited text).',
      inputSchema: upsertScanSchemeSchema,
    },
    async (args: z.infer<typeof upsertScanSchemeSchema>) => {
      const result = await scanCodesApi.upsertScanScheme(args);
      return asText(result.data ?? { error: result.error });
    },
  );

  // mirrors PUT /api/scan-codes/schemes/:version/actions/:category
  (server as any).registerTool(
    'upsert_scan_rule',
    {
      title: 'Upsert Scan Rule',
      description:
        'Create or replace a scan rule for a scheme category: a friendly name, ' +
        'ordered condition/action steps (first matching query wins its verb), and ' +
        'a fallback screen when nothing matches.',
      inputSchema: upsertScanRuleSchema,
    },
    async (args: z.infer<typeof upsertScanRuleSchema>) => {
      const result = await scanCodesApi.upsertScanRule({
        scheme_version: args.scheme_version,
        category: args.category,
        name: args.name,
        steps: args.steps,
        fallback: args.fallback,
        notPrimed: args.notPrimed,
        enabled: args.enabled,
      });
      return asText(result.data ?? { error: result.error });
    },
  );

  // mirrors DELETE /api/scan-codes/schemes/:version/actions/:category
  (server as any).registerTool(
    'delete_scan_rule',
    {
      title: 'Delete Scan Rule',
      description: 'Delete one scan rule (scheme version + two-digit category).',
      inputSchema: deleteScanRuleSchema,
    },
    async (args: z.infer<typeof deleteScanRuleSchema>) => {
      const result = await scanCodesApi.deleteScanRule({
        version: args.scheme_version,
        category: args.category,
      });
      return asText(result.data ?? { error: result.error });
    },
  );
}
