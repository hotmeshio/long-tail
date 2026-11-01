import { describe, it, expect, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';
import { registerMachineSurface } from '../../modules/machines';
import { commandOpsOf, summarizeLine, type LineSurface, type WireProbe } from '../../services/machines/surface';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';
import type { LineDef } from '../../lib/machines/line';
import type { InspectResult, LineView } from '../../types/machines-view';

const ctx = setupRouteTest(4653);

// /api/machines, the Lines view's server side. The surface is registered
// in process, as start({ machines }) registers it; the routes read it.

const { siteId, lineId } = DEFAULT_LINE;
const LINE_PATH = `/machines/lines/${siteId}/${lineId}`;
const COMMAND_ROLE = 'line-bond';

function surface(leading: boolean): LineSurface {
  const view: LineView = { siteId, lineId, leading: true, takenAt: '2026-03-01T08:00:00.000Z', machines: [], contested: [] };
  const planned = (probe: WireProbe): InspectResult => ({
    kind: 'job', event: 'arrived', summary: `job arrived (${probe.topic})`, inspections: [], violations: [], actions: [{ verb: 'none', detail: 'waiting for its row (delivery 1)' }],
  });
  const declared = (s: string, l: string) => s === siteId && l === lineId;
  return {
    describeLines: () => [summarizeLine(DEFAULT_LINE, { rowOps: ['probe'] })],
    describeLine: (s, l) => (leading && declared(s, l) ? view : null),
    inspect: (s, l, probe) => (leading && declared(s, l) ? planned(probe) : null),
    findLine: (s, l) => (declared(s, l) ? DEFAULT_LINE : undefined),
    commandOps: () => commandOpsOf({ rowOps: ['probe'] }),
    declare: async (line: LineDef) => { runs.push(`declare ${line.siteId}/${line.lineId}`); return 'started'; },
    retire: async (s: string, l: string) => { runs.push(`retire ${s}/${l}`); return true; },
  };
}

/** What the fake surface was asked to run or stop. */
const runs: string[] = [];
const OTHER_SITE = 'site-9';
const otherLine = (lineId: string, machines = DEFAULT_LINE.machines): LineDef => ({ ...DEFAULT_LINE, siteId: OTHER_SITE, lineId, machines });

const put = (ctxBase: string, token: string, s: string, l: string, body: Record<string, unknown>) =>
  fetch(`${ctxBase}/machines/lines/${s}/${l}`, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify(body) });

describe('machines routes', () => {
  afterAll(async () => {
    registerMachineSurface(null);
    await getPool().query('DELETE FROM public.hmsh_escalations WHERE role = $1', [COMMAND_ROLE]);
    await getPool().query('DELETE FROM lt_machine_lines WHERE site_id = ANY($1)', [[siteId, OTHER_SITE]]);
  });

  it('with no lines declared there are no lines and no machines in the settings', async () => {
    registerMachineSurface(null);
    const lines = await fetch(`${ctx.BASE}/machines/lines`, { headers: authHeaders(ctx.builderToken) });
    expect(lines.status).toBe(404);
    const settings = await (await fetch(`${ctx.BASE}/settings`)).json();
    expect(settings).not.toHaveProperty('machines');
  });

  it('reads take an ops-type role', async () => {
    registerMachineSurface(surface(true));
    expect((await fetch(`${ctx.BASE}/machines/lines`)).status).toBe(401);
    expect((await fetch(`${ctx.BASE}/machines/lines`, { headers: authHeaders(ctx.memberToken) })).status).toBe(403);
    expect((await fetch(`${ctx.BASE}${LINE_PATH}`, { headers: authHeaders(ctx.memberToken) })).status).toBe(403);
  });

  it('declaring a line takes an administrator, needs a definition for that line, and runs it here', async () => {
    registerMachineSurface(surface(true));
    expect((await put(ctx.BASE, ctx.memberToken, siteId, lineId, { definition: DEFAULT_LINE })).status).toBe(403);
    expect((await put(ctx.BASE, ctx.builderToken, siteId, lineId, {})).status).toBe(400);
    expect((await put(ctx.BASE, ctx.builderToken, siteId, 'elsewhere', { definition: DEFAULT_LINE })).status).toBe(400);
    const empty = await put(ctx.BASE, ctx.builderToken, siteId, lineId, { definition: { ...DEFAULT_LINE, machines: [] } });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/no machines/);

    const made = await put(ctx.BASE, ctx.builderToken, siteId, lineId, { definition: DEFAULT_LINE });
    expect(made.status).toBe(200);
    const { line } = await made.json();
    expect(line).toMatchObject({ siteId, lineId, source: 'api', version: 1, leading: true, health: { machines: 3, attention: false } });
    expect(line.machines[0]).toMatchObject({ machineId: 'press-01', role: COMMAND_ROLE, rowOps: ['probe'] });
    expect(runs).toContain(`declare ${siteId}/${lineId}`);

    const stale = await put(ctx.BASE, ctx.builderToken, siteId, lineId, { definition: DEFAULT_LINE, version: 7 });
    expect(stale.status).toBe(409);
    expect((await put(ctx.BASE, ctx.builderToken, siteId, lineId, { definition: DEFAULT_LINE, version: 0 })).status).toBe(400);
  });

  it('lists the registry with each line\'s codec ops and health, searched and paged in SQL, in the settings too', async () => {
    registerMachineSurface(surface(true));
    expect((await put(ctx.BASE, ctx.builderToken, OTHER_SITE, 'a', { definition: otherLine('a') })).status).toBe(200);
    expect((await put(ctx.BASE, ctx.builderToken, OTHER_SITE, 'b', { definition: otherLine('b', DEFAULT_LINE.machines.slice(0, 1)) })).status).toBe(200);

    const res = await fetch(`${ctx.BASE}/machines/lines?sort=site`, { headers: authHeaders(ctx.builderToken) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.lines.map((l: any) => `${l.siteId}/${l.lineId}`)).toEqual([`${siteId}/${lineId}`, `${OTHER_SITE}/a`, `${OTHER_SITE}/b`]);
    expect(body.lines[0].machines[0]).toMatchObject({ machineId: 'press-01', role: COMMAND_ROLE, rowOps: ['probe'] });
    expect(body.lines[0].leading).toBe(true);
    expect(body.lines[1]).toMatchObject({ leading: false, health: { machines: 3 } });
    expect(body.lines[1].machines[0]).not.toHaveProperty('rowOps');
    expect(body.sites).toEqual([{ siteId, lines: 1, attention: 0 }, { siteId: OTHER_SITE, lines: 2, attention: 0 }]);

    const searched = await (await fetch(`${ctx.BASE}/machines/lines?q=cut-01&site=${OTHER_SITE}`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(searched.lines.map((l: any) => l.lineId)).toEqual(['a']);
    const paged = await (await fetch(`${ctx.BASE}/machines/lines?sort=site&limit=1&offset=2`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(paged).toMatchObject({ total: 3, limit: 1, offset: 2 });
    expect(paged.lines.map((l: any) => l.lineId)).toEqual(['b']);
    expect((await fetch(`${ctx.BASE}/machines/lines?sort=sideways`, { headers: authHeaders(ctx.builderToken) })).status).toBe(400);

    const settings = await (await fetch(`${ctx.BASE}/settings`)).json();
    expect(settings.machines.lines[0].machines.map((m: any) => m.machineId)).toEqual(['press-01', 'cut-01', 'inspect-01']);
  });

  it('a pending row for a person puts the line in need of attention; attention sorts first and filters', async () => {
    registerMachineSurface(surface(true));
    const row = await fetch(`${ctx.BASE}/escalations`, {
      method: 'POST', headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ type: 'handoff-error', role: COMMAND_ROLE, description: 'jam', metadata: { siteId: OTHER_SITE, lineId: 'b', machineId: 'press-01' } }),
    });
    expect(row.status).toBe(201);
    const body = await (await fetch(`${ctx.BASE}/machines/lines`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(body.lines[0]).toMatchObject({ siteId: OTHER_SITE, lineId: 'b', health: { people: 1, attention: true } });
    expect(body.sites.find((s: any) => s.siteId === OTHER_SITE)).toEqual({ siteId: OTHER_SITE, lines: 2, attention: 1 });
    const only = await (await fetch(`${ctx.BASE}/machines/lines?attention=true`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(only.lines.map((l: any) => `${l.siteId}/${l.lineId}`)).toEqual([`${OTHER_SITE}/b`]);
    const calm = await (await fetch(`${ctx.BASE}/machines/lines?attention=false`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(calm.total).toBe(2);
  });

  it('retiring a line takes an administrator, stops it here, and is not found twice', async () => {
    registerMachineSurface(surface(true));
    const del = (token: string, l: string) => fetch(`${ctx.BASE}/machines/lines/${OTHER_SITE}/${l}`, { method: 'DELETE', headers: authHeaders(token) });
    expect((await del(ctx.memberToken, 'a')).status).toBe(403);
    expect((await del(ctx.builderToken, 'a')).status).toBe(204);
    expect(runs).toContain(`retire ${OTHER_SITE}/a`);
    expect((await del(ctx.builderToken, 'a')).status).toBe(404);
    const body = await (await fetch(`${ctx.BASE}/machines/lines?site=${OTHER_SITE}`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(body.lines.map((l: any) => l.lineId)).toEqual(['b']);
  });

  it('a leader serves the line; a replica standing by says leading false; an undeclared line is not found', async () => {
    registerMachineSurface(surface(true));
    const led = await fetch(`${ctx.BASE}${LINE_PATH}`, { headers: authHeaders(ctx.builderToken) });
    expect(led.status).toBe(200);
    expect(await led.json()).toMatchObject({ leading: true, takenAt: '2026-03-01T08:00:00.000Z' });

    registerMachineSurface(surface(false));
    const standby = await fetch(`${ctx.BASE}${LINE_PATH}`, { headers: authHeaders(ctx.builderToken) });
    expect(standby.status).toBe(200);
    expect(await standby.json()).toEqual({ siteId, lineId, leading: false });
    expect((await fetch(`${ctx.BASE}/machines/lines/${siteId}/nowhere`, { headers: authHeaders(ctx.builderToken) })).status).toBe(404);
  });

  it('inspect dry-runs a message on the leader, needs a topic, and is a conflict elsewhere', async () => {
    registerMachineSurface(surface(true));
    const res = await fetch(`${ctx.BASE}${LINE_PATH}/inspect`, {
      method: 'POST', headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ topic: 'line/v1/site-1/line-1/press-01/job', payload: { body: { event: 'arrived' } } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'job', event: 'arrived', actions: [{ verb: 'none' }] });
    const missing = await fetch(`${ctx.BASE}${LINE_PATH}/inspect`, { method: 'POST', headers: authHeaders(ctx.builderToken), body: JSON.stringify({ payload: 'x' }) });
    expect(missing.status).toBe(400);

    registerMachineSurface(surface(false));
    const standby = await fetch(`${ctx.BASE}${LINE_PATH}/inspect`, { method: 'POST', headers: authHeaders(ctx.builderToken), body: JSON.stringify({ topic: 't', payload: 'x' }) });
    expect(standby.status).toBe(409);
  });

  it('a command is a row on the machine\'s role as the caller: the role decides, the op must be one the line takes', async () => {
    registerMachineSurface(surface(true));
    const post = (machineId: string, body: Record<string, unknown>, token: string) => fetch(`${ctx.BASE}${LINE_PATH}/machines/${machineId}/commands`, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
    });
    expect((await post('mill-99', { op: 'pause' }, ctx.builderToken)).status).toBe(404);
    const badOp = await post('press-01', { op: 'dispatch' }, ctx.builderToken);
    expect(badOp.status).toBe(400);
    expect((await badOp.json()).error).toMatch(/probe/);
    expect((await post('press-01', { op: 'pause', args: [] }, ctx.builderToken)).status).toBe(400);
    expect((await post('press-01', { op: 'pause' }, ctx.memberToken)).status).toBe(403);

    const made = await post('press-01', { op: 'probe', args: { depth: 2 } }, ctx.builderToken);
    expect(made.status).toBe(201);
    const { rowId } = await made.json();
    expect(rowId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await (await fetch(`${ctx.BASE}/escalations/${rowId}`, { headers: authHeaders(ctx.builderToken) })).json();
    expect(row).toMatchObject({ role: COMMAND_ROLE, type: 'machine-command', subtype: 'probe', metadata: { siteId, lineId, machineId: 'press-01', op: 'probe', args: { depth: 2 } } });
  });
});
