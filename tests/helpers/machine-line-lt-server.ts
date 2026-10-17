/**
 * A tiny HTTP stand-in for the parts of the Long Tail API the gateway calls:
 * routes are registered per test, every request is recorded.
 */

import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

export interface Seen { method: string; path: string; auth?: string; body?: any }
export type Route = (req: Seen) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

export class FakeLtServer {
  readonly seen: Seen[] = [];
  private routes: [string, RegExp, Route][] = [];
  private server?: Server;
  baseUrl = '';

  on(method: string, path: RegExp, route: Route): this {
    this.routes.push([method, path, route]);
    return this;
  }

  async start(): Promise<this> {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const seen: Seen = { method: req.method!, path: req.url!.replace(/^\/api/, ''), auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined };
      this.seen.push(seen);
      const match = this.routes.find(([m, p]) => m === seen.method && p.test(seen.path));
      const { status, body } = match ? await match[2](seen) : { status: 404, body: { error: 'no route' } };
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? {}));
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', () => r()));
    this.baseUrl = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }
}
