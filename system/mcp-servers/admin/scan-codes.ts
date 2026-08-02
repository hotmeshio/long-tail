/**
 * Scan-code tools — mirrors routes/scan-codes.ts
 *
 * Schemes map a code's leading two digits (10-99) to a target metadata facet
 * and parse shape; rules map a single-digit category (0-9) to ordered
 * condition/action steps over the escalation surface. execute_scan_code runs a raw code as
 * the lt-system principal (see escalations.ts for the principal rationale).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as scanCodesApi from '../../../api/scan-codes';
import { ensureSystemBot } from '../../../services/iam';
import type { LTApiAuth } from '../../../types/sdk';
import {
  executeScanCodeSchema,
  executeScanChoiceSchema,
  listScanSchemesSchema,
  upsertScanSchemeSchema,
  upsertScanRuleSchema,
  deleteScanRuleSchema,
} from './schemas';

let systemPrincipalId: string | null = null;

async function systemAuth(): Promise<LTApiAuth> {
  if (!systemPrincipalId) systemPrincipalId = await ensureSystemBot();
  return { userId: systemPrincipalId, role: 'superadmin' };
}

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
        'Execute a raw scan code (version:category:target). Parses against the ' +
        'configured schemes, walks the rule\'s condition/action steps, and returns ' +
        'a structured outcome (executed, confirm_required, matched_list, ' +
        'no_match_fallback, unconfigured, invalid_code, forbidden, conflict).',
      inputSchema: executeScanCodeSchema,
    },
    async (args: z.infer<typeof executeScanCodeSchema>) => {
      const result = await scanCodesApi.executeScanCode({
        code: args.code,
        actingToken: args.actingToken,
        previousActingToken: args.previousActingToken,
      }, await systemAuth());
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
    async (args: z.infer<typeof executeScanChoiceSchema>) => {
      const result = await scanCodesApi.executeScanChoice(args, await systemAuth());
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
