/**
 * The simulated printer's drills, over plain HTTP: what someone at a real
 * printer would do. `GET /` answers the printer's state and the files on its
 * storage; each POST plays one event.
 *
 *   curl -X POST localhost:8092/runout     the external spool runs out mid-print
 *   curl -X POST localhost:8092/resume     someone loads filament and resumes at the printer
 *   curl -X POST localhost:8092/occupy     a print started elsewhere takes the printer
 *   curl -X POST localhost:8092/vacate     that print ends; the printer is idle
 *   curl -X POST localhost:8092/hold -d '{"percent":50}'   progress stops at 50% until release
 *   curl -X POST localhost:8092/release
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

import type { StoredFile } from './ftps';
import type { SimPrinter } from './printer';

type Drill = (printer: SimPrinter, body: Record<string, any>) => void;

const DRILLS: Record<string, Drill> = {
  runout: (p) => p.runOut(),
  resume: (p) => p.resumeAtPrinter(),
  occupy: (p) => p.occupy(),
  vacate: (p) => p.vacate(),
  hold: (p, b) => p.hold(Number(b.percent ?? 50)),
  release: (p) => p.release(),
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function startControl(printer: SimPrinter, stored: Map<string, StoredFile>, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://sim').pathname.replace(/^\/+|\/+$/g, '');
    if (req.method === 'GET' && !path) return send(res, 200, { state: printer.state, files: [...stored.values()] });
    const drill = DRILLS[path];
    if (req.method !== 'POST' || !drill) return send(res, 404, { error: `no drill ${req.method} /${path}` });
    readJson(req)
      .then((body) => {
        drill(printer, body);
        send(res, 200, { ok: true, state: printer.state });
      })
      .catch((err) => send(res, 400, { error: err.message }));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
