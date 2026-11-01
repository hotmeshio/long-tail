import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { start } from '../../../start';
import { getPool } from '../../../lib/db';
import { loggerRegistry } from '../../../lib/logger';
import { telemetryRegistry } from '../../../lib/telemetry';
import { eventRegistry } from '../../../lib/events';
import { maintenanceRegistry } from '../../../services/maintenance';
import { mcpRegistry } from '../../../services/mcp/index';
import { registerMachineSurface } from '../../../modules/machines';
import { commandOpsOf, summarizeLine, type LineSurface, type WireProbe } from '../../../services/machines/surface';
import { getLine } from '../../../services/machines/registry';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import type { LineDef } from '../../../lib/machines/line';
import type { InspectResult, LineView } from '../../../types/machines-view';
import { createMachinesServer, stopMachinesServer, MACHINE_TOOL } from '../../../system/mcp-servers/machines';
import { MACHINE_TOOLS } from '../../../system/seed/tool-manifests-machines';
import { builtinMcpServerFactories } from '../../../system';
import { parseMcpResult } from '../../setup/mcp';
import type { LTInstance } from '../../../types/startup';

// The machines MCP server: the Lines index and views, a dry run, command
// rows, and the registry's declare and retire, through an in-memory client
// against a fake surface. Declare and retire write the real registry.

const TEST_DB = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5415', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: 'longtail_test',
};

const { siteId, lineId } = DEFAULT_LINE;
const SITE = `mcp-${Date.now().toString(36)}`;
const COMMAND_ROLE = 'line-bond';
const running = new Map<string, LineDef>([[`${siteId}/${lineId}`, DEFAULT_LINE]]);

function fakeSurface(leading: boolean): LineSurface {
  const view: LineView = { siteId, lineId, leading: true, takenAt: '2026-03-01T08:00:00.000Z', machines: [], contested: [] };
  const planned = (probe: WireProbe): InspectResult => ({
    kind: 'job', event: 'arrived', summary: `job arrived (${probe.topic})`, inspections: [], violations: [], actions: [{ verb: 'none' }],
  });
  return {
    describeLines: () => [...running.values()].map((l) => summarizeLine(l, { rowOps: ['probe'] })),
    describeLine: (s, l) => (leading && s === siteId && l === lineId ? view : null),
    inspect: (s, l, probe) => (leading && s === siteId && l === lineId ? planned(probe) : null),
    findLine: (s, l) => running.get(`${s}/${l}`),
    commandOps: () => commandOpsOf({ rowOps: ['probe'] }),
    declare: async (def) => { running.set(`${def.siteId}/${def.lineId}`, def); return 'started'; },
    retire: async (s, l) => running.delete(`${s}/${l}`),
  };
}

describe('machines MCP server', () => {
  let lt: LTInstance;
  let client: InstanceType<typeof McpClient>;
  const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

  beforeAll(async () => {
    loggerRegistry.clear(); telemetryRegistry.clear(); eventRegistry.clear(); maintenanceRegistry.clear(); mcpRegistry.clear();
    lt = await start({ database: TEST_DB, server: { enabled: false }, maintenance: false });
    await stopMachinesServer();
    const server = await createMachinesServer({ name: 'test-machines' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new McpClient({ name: 'test-machines-client', version: '1.0.0' });
    await client.connect(clientTransport);
    registerMachineSurface(fakeSurface(true));
  }, 30_000);

  afterAll(async () => {
    registerMachineSurface(null);
    await getPool().query('DELETE FROM lt_machine_lines WHERE site_id = $1', [SITE]);
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE role = $1 AND metadata @> $2', [COMMAND_ROLE, JSON.stringify({ siteId, lineId })]);
    await client.close();
    await stopMachinesServer();
    await lt.shutdown();
  });

  it('every registered tool has a manifest entry with an explicit read_safe flag, and the factory carries it', async () => {
    const server = await createMachinesServer({ fresh: true, name: 'manifest-test' });
    const registered = Object.keys((server as any)._registeredTools as Record<string, unknown>).sort();
    expect(registered).toEqual([...MACHINE_TOOLS.map((t) => t.name)].sort());
    for (const entry of MACHINE_TOOLS) expect(typeof entry.read_safe, `read_safe missing on ${entry.name}`).toBe('boolean');
    expect(MACHINE_TOOLS.filter((t) => t.read_safe).map((t) => t.name).sort()).toEqual([MACHINE_TOOL.GET, MACHINE_TOOL.INSPECT, MACHINE_TOOL.LIST].sort());
    expect(MACHINE_TOOLS.filter((t) => t.gate === 'admin').map((t) => t.name).sort()).toEqual([MACHINE_TOOL.DECLARE, MACHINE_TOOL.RETIRE].sort());
    expect(builtinMcpServerFactories['long-tail-machines']?.config?.toolManifest).toBe(MACHINE_TOOLS);
    await server.close();
  });

  it('without a surface the index says no lines are declared and the rest refuse', async () => {
    registerMachineSurface(null);
    expect(parseMcpResult(await call(MACHINE_TOOL.LIST, {}))).toEqual({ lines: [], total: 0, sites: [], declared: false });
    const res = await call(MACHINE_TOOL.GET, { siteId, lineId });
    expect(res.isError).toBe(true);
    registerMachineSurface(fakeSurface(true));
  });

  it('reads a line as its leader sees it, with the summary and the command ops', async () => {
    const body = parseMcpResult(await call(MACHINE_TOOL.GET, { siteId, lineId }));
    expect(body).toMatchObject({ siteId, lineId, leading: true });
    expect(body.summary.machines[0]).toMatchObject({ machineId: 'press-01', role: COMMAND_ROLE, rowOps: ['probe'] });
    expect(body.commandOps).toContain('snapshot');
    expect(body.commandOps).toContain('probe');
    const missing = await call(MACHINE_TOOL.GET, { siteId, lineId: 'nope' });
    expect(missing.isError).toBe(true);
  });

  it('standing by, the line answers leading false and the dry run refuses', async () => {
    registerMachineSurface(fakeSurface(false));
    expect(parseMcpResult(await call(MACHINE_TOOL.GET, { siteId, lineId }))).toMatchObject({ leading: false });
    const res = await call(MACHINE_TOOL.INSPECT, { siteId, lineId, topic: 'line/v1/site-1/line-1/press-01/job', payload: { event: 'arrived' } });
    expect(res.isError).toBe(true);
    registerMachineSurface(fakeSurface(true));
  });

  it('dry-runs a message on the leader and applies nothing', async () => {
    const body = parseMcpResult(await call(MACHINE_TOOL.INSPECT, { siteId, lineId, topic: 'line/v1/site-1/line-1/press-01/job', payload: { event: 'arrived' } }));
    expect(body).toMatchObject({ kind: 'job', event: 'arrived', summary: 'job arrived (line/v1/site-1/line-1/press-01/job)' });
  });

  it('parks a command row on the machine\'s role and refuses an unknown op or machine', async () => {
    const body = parseMcpResult(await call(MACHINE_TOOL.COMMAND, { siteId, lineId, machineId: 'press-01', op: 'pause' }));
    expect(body.rowId).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await getPool().query('SELECT role, type, metadata FROM public.hmsh_escalations WHERE id = $1', [body.rowId]);
    expect(rows[0]).toMatchObject({ role: COMMAND_ROLE, type: 'machine-command' });
    expect(rows[0].metadata).toMatchObject({ siteId, lineId, machineId: 'press-01', op: 'pause' });
    expect((await call(MACHINE_TOOL.COMMAND, { siteId, lineId, machineId: 'press-01', op: 'explode' })).isError).toBe(true);
    expect((await call(MACHINE_TOOL.COMMAND, { siteId, lineId, machineId: 'ghost', op: 'pause' })).isError).toBe(true);
  });

  it('declares a line into the registry, runs it, lists it, conflicts on a stale version, and retires it', async () => {
    const definition = { ...DEFAULT_LINE, siteId: SITE, lineId: 'l-1' };
    const declared = parseMcpResult(await call(MACHINE_TOOL.DECLARE, { definition }));
    expect(declared.line).toMatchObject({ siteId: SITE, lineId: 'l-1', source: 'api', version: 1 });
    expect(running.has(`${SITE}/l-1`)).toBe(true);
    expect((await getLine(SITE, 'l-1'))?.version).toBe(1);

    const listed = parseMcpResult(await call(MACHINE_TOOL.LIST, { q: SITE }));
    expect(listed.total).toBe(1);
    expect(listed.lines[0]).toMatchObject({ siteId: SITE, lineId: 'l-1', health: { machines: DEFAULT_LINE.machines.length } });
    expect(listed.sites.some((s: { siteId: string }) => s.siteId === SITE)).toBe(true);

    const stale = await call(MACHINE_TOOL.DECLARE, { definition, version: 9 });
    expect(stale.isError).toBe(true);
    expect(String((stale.content as { text: string }[])[0].text)).toMatch(/version/);
    const invalid = await call(MACHINE_TOOL.DECLARE, { definition: { ...definition, machines: [] } });
    expect(invalid.isError).toBe(true);

    expect(parseMcpResult(await call(MACHINE_TOOL.RETIRE, { siteId: SITE, lineId: 'l-1' }))).toMatchObject({ retired: true });
    expect(running.has(`${SITE}/l-1`)).toBe(false);
    expect(await getLine(SITE, 'l-1')).toBeNull();
    expect((await call(MACHINE_TOOL.RETIRE, { siteId: SITE, lineId: 'l-1' })).isError).toBe(true);
  });
});
