/**
 * Print one file on a Bambu printer through Long Tail, and follow its rows.
 * Run it where the printer is reachable, e.g. in the Long Tail container:
 *
 *   docker compose exec long-tail npm run bambu:print -- examples/workflows/bambu-printer/files/part.gcode.3mf [station]
 *
 * 1. Put the file on the printer (it prints only files on its own storage) and hash it: the unit's artifact.
 * 2. Start the unit route: one print step at the station, then a person unloads.
 * 3. Print the route's rows and their lifecycle items as they change, until the
 *    route ends. The unload row is resolved by a person on the dashboard.
 *
 * Env: LT_USERNAME and LT_PASSWORD (a Long Tail login that may invoke the route), BASE_URL
 * (http://localhost:3000), BAMBU_SITE_DIR (deploy/bambu-site), and the printers in .env.
 */

try { require('dotenv/config'); } catch { /* dotenv optional */ }

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { basename, join } from 'path';

import { BAMBU_ROLES, PRINT_PROCESS, PRINT_RECIPE, printersFromEnv } from '../examples/workflows/bambu-printer/env';
import { stageFile } from '../examples/workflows/bambu-printer/files';
import { UNIT_ROUTE_WORKFLOW, type UnitRouteInput } from '../examples/workflows/machine-line/workflows/route';
import type { LineDef } from '../types/machines';

const env = process.env;
const BASE_URL = env.BASE_URL || 'http://localhost:3000';
const SITE_DIR = env.BAMBU_SITE_DIR || 'deploy/bambu-site';
const WATCH_MS = 3_000;

const ts = () => new Date().toISOString().slice(11, 19);
const say = (msg: string) => console.log(`[${ts()}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let token = '';

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

/** The route's rows, and the items each holds, printed as they change; the route's result once it ends. */
async function follow(orderRef: string, workflowId: string): Promise<unknown> {
  const shown = new Map<string, string>();
  for (;;) {
    try {
      const result = await look(orderRef, workflowId, shown);
      if (result) return result;
    } catch (err) {
      // A restart or a database blip is not the route ending: keep following.
      say(`(could not read the route: ${(err as Error).message}; trying again)`);
    }
    await sleep(WATCH_MS);
  }
}

async function look(orderRef: string, workflowId: string, shown: Map<string, string>): Promise<unknown> {
  const facets = encodeURIComponent(JSON.stringify({ orderRef }));
  const { escalations } = await api('GET', `/escalations?facets=${facets}&limit=20&sort_by=created_at&order=asc`);
  for (const row of escalations) {
    const { items = [] } = await api('GET', `/escalations/${row.id}/items`);
    const view = `${row.type}/${row.role} ${row.status}${row.assigned_to ? ' claimed' : ''} [${items.map((i: any) => i.itemKey).join(', ')}]`;
    if (shown.get(row.id) !== view) say(`${row.id.slice(0, 8)} ${view}`);
    shown.set(row.id, view);
  }
  const resp = await api('GET', `/workflows/${workflowId}/result`).catch(() => null);
  return resp?.result?.data?.status ? resp.result.data : null;
}

async function main(): Promise<void> {
  const [file, stationArg] = process.argv.slice(2);
  if (!file) throw new Error('usage: npm run bambu:print -- path/to/part.gcode.3mf [station]');
  const line: LineDef = JSON.parse(readFileSync(join(SITE_DIR, 'line.json'), 'utf8'));
  const station = stationArg || line.machines[0].machineId;
  const printer = printersFromEnv().find((p) => p.station === station);
  if (!printer || !line.machines.some((m) => m.machineId === station)) throw new Error(`${station} is not an enabled printer on the line in ${SITE_DIR}/line.json`);

  // 1. The artifact, on the printer
  const routeKey = `P${Date.now().toString(36)}`;
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  say(`copying ${basename(file)} to ${station} (a minute or two for a few MB)`);
  const url = await stageFile(printer, file, `${routeKey}.gcode.3mf`);
  say(`${url} (sha256 ${sha256.slice(0, 12)}…)`);

  // 2. The route
  const { LT_USERNAME: username, LT_PASSWORD: password } = env;
  if (!username || !password) throw new Error('set LT_USERNAME and LT_PASSWORD in .env');
  token = (await api('POST', '/auth/login', { username, password })).token;
  const input: UnitRouteInput = {
    siteId: line.siteId, lineId: line.lineId, routeKey, orderRef: `ORD-${routeKey}`,
    units: [{ unitId: `U-${routeKey}`, carrierId: `PLATE-${routeKey}` }],
    steps: [{ machineId: station, process: PRINT_PROCESS, recipe: { ...PRINT_RECIPE } }],
    artifact: { url, sha256 }, exitRole: BAMBU_ROLES.UNLOAD, handoffTimeout: env.BAMBU_HANDOFF_TIMEOUT || '6h',
  };
  const workflowId = `bambu-${routeKey}`;
  await api('POST', `/workflows/${UNIT_ROUTE_WORKFLOW}/invoke`, { data: input, metadata: { source: 'bambu-print' }, workflowId });
  say(`started ${workflowId} on ${station}; unload the part on the dashboard (${BAMBU_ROLES.UNLOAD}) when it finishes`);

  // 3. Follow it
  say(`route ended: ${JSON.stringify(await follow(input.orderRef, workflowId))}`);
}

main().catch((err) => {
  console.error(`[${ts()}] failed: ${err.message}`);
  process.exit(1);
});
