import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';

import { createEscalation } from '../../api/escalations';
import { loggerRegistry } from '../../lib/logger';
import { getMachineSurface } from '../../modules/machines';
import { commandRow, commandTarget } from '../../services/machines/commands';
import { registeredToolCount } from '../../services/mcp/registered-tools';
import { emptyLineHealth, lineSummaryOf, toLineIndexRow, wirePayloadOf } from '../../services/machines/line-index';
import { LineVersionConflict, getLineWithHealth, listLines, listSites, type LineListQuery } from '../../services/machines/registry';
import { declareLine, retireLine } from '../../services/machines/registry-sync';
import type { LineIndex } from '../../types/machines-view';
import { callerAuth, type ToolCallExtra } from './caller-auth';
import {
  declareMachineLineSchema, getMachineLineSchema, inspectMachineMessageSchema, listMachineLinesSchema,
  retireMachineLineSchema, sendMachineCommandSchema,
} from './machines-schemas';

export const MACHINES_SERVER_NAME = 'long-tail-machines';

export const MACHINE_TOOL = {
  LIST: 'list_machine_lines',
  GET: 'get_machine_line',
  INSPECT: 'inspect_machine_message',
  COMMAND: 'send_machine_command',
  DECLARE: 'declare_machine_line',
  RETIRE: 'retire_machine_line',
} as const;

const NO_LINES = 'no machine lines are declared: start({ machines }) was not given';
const NOT_LEADING = 'this replica is not leading the line';

let server: McpServer | null = null;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (body: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });
const noLine = (siteId: string, lineId: string) => fail(`no line ${siteId}/${lineId}`);

function registerTools(srv: McpServer): void {
  (srv as any).registerTool(
    MACHINE_TOOL.LIST,
    {
      title: 'List Machine Lines',
      description: 'The lines index: every declared line with its machines and health (offline, alarms, rows waiting on people, work in flight), searchable, filtered by site or attention, paginated.',
      inputSchema: listMachineLinesSchema,
    },
    async (args: z.infer<z.ZodObject<typeof listMachineLinesSchema>>) => {
      const surface = getMachineSurface();
      if (!surface) return ok({ lines: [], total: 0, sites: [], declared: false });
      const query: LineListQuery = { q: args.q, site: args.site, attention: args.attention, sort: args.sort, limit: args.limit, offset: args.offset };
      const [page, sites] = await Promise.all([listLines(query), listSites()]);
      const body: LineIndex & { declared: boolean } = {
        lines: page.lines.map((record) => toLineIndexRow(surface, record)),
        total: page.total, sites, limit: page.limit, offset: page.offset, declared: true,
      };
      return ok(body);
    },
  );

  (srv as any).registerTool(
    MACHINE_TOOL.GET,
    {
      title: 'Get Machine Line',
      description: 'One line as its leader sees it: machine links, held units, open rows, alarms, last snapshots and contested claims, with the stored summary (machines, roles, addresses, command ops). A replica not leading the line answers leading: false.',
      inputSchema: getMachineLineSchema,
    },
    async (args: z.infer<z.ZodObject<typeof getMachineLineSchema>>) => {
      const surface = getMachineSurface();
      if (!surface) return fail(NO_LINES);
      const line = surface.findLine(args.siteId, args.lineId);
      if (!line) return noLine(args.siteId, args.lineId);
      const summary = lineSummaryOf(surface, args.siteId, args.lineId, line);
      const view = surface.describeLine(args.siteId, args.lineId) ?? { siteId: args.siteId, lineId: args.lineId, leading: false };
      return ok({ ...view, summary, commandOps: surface.commandOps(args.siteId, args.lineId) });
    },
  );

  (srv as any).registerTool(
    MACHINE_TOOL.INSPECT,
    {
      title: 'Inspect Machine Message',
      description: 'A dry run of one wire message on the leader\'s state: what the codec reads, the contract violations found, and what the gateway would do, with nothing applied.',
      inputSchema: inspectMachineMessageSchema,
    },
    async (args: z.infer<z.ZodObject<typeof inspectMachineMessageSchema>>) => {
      const surface = getMachineSurface();
      if (!surface) return fail(NO_LINES);
      if (!surface.findLine(args.siteId, args.lineId)) return noLine(args.siteId, args.lineId);
      const result = surface.inspect(args.siteId, args.lineId, { topic: args.topic, payload: wirePayloadOf(args.payload), retained: args.retained === true });
      return result ? ok(result) : fail(NOT_LEADING);
    },
  );

  (srv as any).registerTool(
    MACHINE_TOOL.COMMAND,
    {
      title: 'Send Machine Command',
      description: 'Park a machine-command row on the machine\'s role as the caller; the line\'s gateway sends it and resolves the row with the machine\'s reply. Ops: start, stop, pause, resume, changeover, ack-alarm, snapshot, and any the codec declares.',
      inputSchema: sendMachineCommandSchema,
    },
    async (args: z.infer<z.ZodObject<typeof sendMachineCommandSchema>>, extra?: ToolCallExtra) => {
      const surface = getMachineSurface();
      if (!surface) return fail(NO_LINES);
      const line = surface.findLine(args.siteId, args.lineId);
      if (!line) return noLine(args.siteId, args.lineId);
      if (!line.machines.some((m) => m.machineId === args.machineId)) return fail(`no machine ${args.machineId} on ${args.siteId}/${args.lineId}`);
      const ops = surface.commandOps(args.siteId, args.lineId);
      if (!ops.includes(args.op)) return fail(`op must be one of ${ops.join(', ')}`);
      const result = await createEscalation(commandRow(commandTarget(line, args.machineId), args.op, args.args ?? {}), await callerAuth(extra));
      if (result.status !== 201) return fail(result.error ?? `command refused (${result.status})`);
      return ok({ rowId: result.data.id });
    },
  );

  (srv as any).registerTool(
    MACHINE_TOOL.DECLARE,
    {
      title: 'Declare Machine Line',
      description: 'Declare or update a line in the registry: the definition is validated, its roles applied where none exist, the line run on every replica, and the row versioned once per change.',
      inputSchema: declareMachineLineSchema,
    },
    async (args: z.infer<z.ZodObject<typeof declareMachineLineSchema>>) => {
      const surface = getMachineSurface();
      if (!surface) return fail(NO_LINES);
      try {
        const record = await declareLine(surface, args.definition as any, args.version);
        const stored = (await getLineWithHealth(record.siteId, record.lineId)) ?? { ...record, health: emptyLineHealth(record.definition.machines.length) };
        return ok({ line: toLineIndexRow(surface, stored) });
      } catch (err) {
        if (err instanceof LineVersionConflict) return fail(err.message);
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  (srv as any).registerTool(
    MACHINE_TOOL.RETIRE,
    {
      title: 'Retire Machine Line',
      description: 'Retire a line: the row leaves the registry and every replica stops running it. Its roles and bot accounts stay.',
      inputSchema: retireMachineLineSchema,
    },
    async (args: z.infer<z.ZodObject<typeof retireMachineLineSchema>>) => {
      const surface = getMachineSurface();
      if (!surface) return fail(NO_LINES);
      const record = await retireLine(surface, args.siteId, args.lineId);
      return record ? ok({ retired: true, siteId: record.siteId, lineId: record.lineId, version: record.version }) : noLine(args.siteId, args.lineId);
    },
  );
}

/**
 * The machines MCP server: the Lines index and views, a message dry run,
 * command rows, and the registry's declare and retire, for agents.
 */
export async function createMachinesServer(options?: { name?: string; fresh?: boolean }): Promise<McpServer> {
  if (server && !options?.fresh) return server;
  const name = options?.name || MACHINES_SERVER_NAME;
  const instance = new McpServer({ name, version: '1.0.0' });
  if (!options?.fresh) server = instance;
  registerTools(instance);
  loggerRegistry.info(`[lt-mcp:machines] ${name} ready (${registeredToolCount(instance)} tools registered)`);
  return instance;
}

export function getMachinesServer(): McpServer | null {
  return server;
}

export async function stopMachinesServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:machines] stopped');
  }
}
