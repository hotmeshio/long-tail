/**
 * The mock's HTTP surface, plain HTTP and simulation only: the /sim/* drill
 * routes that play the physical world, and the store that serves job
 * artifacts the dispatch op points at.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

import type { MockLine } from './mock-line';

type Handler = (line: MockLine, machineId: string, body: any) => Promise<unknown> | unknown;

const ROUTES: Record<string, Handler> = {
  arrive: (l, m, b) => l.arrive(m, b),
  arm: (l, m, b) => ({ armed: l.arm(m, b) }),
  disarm: (l, m) => l.disarm(m),
  transfer: (l, m, b) => l.armTransfer(m, b),
  alarm: async (l, m, b) => ({ alarmId: await l.alarm(m, b) }),
  'clear-alarm': (l, m, b) => l.clearAlarm(m, b),
  fault: async (l, m, b) => ({ alarmId: await l.fault(m, b) }),
  'emergency-stop': async (l, m) => ({ alarmId: await l.emergencyStop(m) }),
  reset: (l, m, b) => l.reset(m, b),
  'maintenance/start': (l, m) => l.maintenanceStart(m),
  'maintenance/end': (l, m, b) => l.maintenanceEnd(m, b),
  withdraw: (l, m, b) => l.withdraw(m, b),
  restart: (l, m) => l.restart(m),
  recipes: (l, m, b) => l.recipes(m, b),
  network: (l, m, b) => l.network(m, b),
  config: (l, m, b) => l.config(m, b),
  unload: (l, m, b) => l.unload(m, b),
};

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body ?? { ok: true }) : (body as Buffer));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function route(line: MockLine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://mock').pathname.replace(/\/+$/, '');
  if (req.method === 'POST' && path === '/payloads') {
    return send(res, 201, line.payloads.put(await readBody(req)));
  }
  const payload = /^\/payloads\/([\w-]+)$/.exec(path);
  if (req.method === 'GET' && payload) {
    const bytes = line.payloads.get(payload[1]);
    return bytes ? send(res, 200, bytes, 'application/octet-stream') : send(res, 404, { error: 'not found' });
  }
  if (req.method === 'GET' && path === '/sim/state') return send(res, 200, line.state());
  const machineOnly = /^\/sim\/([\w-]+)$/.exec(path);
  if (req.method === 'GET' && machineOnly) return send(res, 200, line.machine(machineOnly[1]).snapshot());
  const action = /^\/sim\/([\w-]+)\/(.+)$/.exec(path);
  const handler = action && ROUTES[action[2]];
  if (req.method === 'POST' && action && handler) {
    const raw = await readBody(req);
    const result = await handler(line, action[1], raw.length ? JSON.parse(raw.toString('utf8')) : {});
    await line.floor.settled();
    return send(res, 200, { ok: true, result: result ?? null });
  }
  send(res, 404, { error: `no route ${req.method} ${path}` });
}

export function startDrillServer(line: MockLine, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    route(line, req, res).catch((err) => send(res, 400, { error: err.message }));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
