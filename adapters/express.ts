import { existsSync, readFileSync } from 'fs';
import path from 'path';
import express, { Router } from 'express';
import type { Server as HttpServer } from 'http';

import routes from '../routes';
import { eventRegistry } from '../lib/events';
import { SocketIOEventAdapter } from '../lib/events/socketio';
import { NatsEventAdapter } from '../lib/events/nats';
import { attachNatsWsProxy } from '../lib/events/nats-ws-proxy';

/**
 * Express adapter for mounting the Long Tail dashboard at an arbitrary subpath
 * inside an existing Express-based application (NestJS, Fastify-Express, etc.).
 *
 * @example NestJS
 * ```typescript
 * import { LTExpressAdapter } from '@hotmeshio/long-tail';
 *
 * const adapter = new LTExpressAdapter();
 * adapter.setBasePath('/admin/longtail');
 *
 * @Module({})
 * export class LongTailUiModule implements NestModule {
 *   configure(consumer: MiddlewareConsumer) {
 *     consumer
 *       .apply(adapter.getRouter())
 *       .forRoutes('/admin/longtail');
 *   }
 *
 *   async onModuleInit() {
 *     // Attach socket.io to the host's HTTP server for real-time events
 *     const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
 *     await adapter.attachServer(httpServer);
 *   }
 * }
 * ```
 *
 * @example Express
 * ```typescript
 * import { LTExpressAdapter } from '@hotmeshio/long-tail';
 *
 * const adapter = new LTExpressAdapter();
 * adapter.setBasePath('/admin/longtail');
 * app.use('/admin/longtail', adapter.getRouter());
 *
 * const server = app.listen(3000);
 * await adapter.attachServer(server);
 * ```
 */
export class LTExpressAdapter {
  private basePath = '';

  /**
   * Set the subpath where the dashboard is mounted.
   * Omit or pass '' for root-level deployment (standalone mode).
   */
  setBasePath(basePath: string): void {
    this.basePath = basePath.replace(/\/+$/, '');
  }

  /**
   * Attach Socket.IO to the host's HTTP server for real-time events.
   *
   * When Long Tail is started with `server: { enabled: false }` (embedded mode),
   * the internal server is not created. Call this after the host server is
   * listening so Socket.IO can bind to it with the correct subpath.
   *
   * Safe to call even when no Socket.IO adapter is registered — it no-ops.
   */
  async attachServer(server: HttpServer): Promise<void> {
    const socketAdapter = eventRegistry.getAdapter(SocketIOEventAdapter);
    if (socketAdapter) {
      // Override the socket.io path to include the base path
      if (this.basePath) {
        socketAdapter.setPath(`${this.basePath}/socket.io`);
      }
      socketAdapter.attachServer(server);
      await socketAdapter.connect();
    }

    // Attach NATS WebSocket proxy (if configured)
    const natsAdapter = eventRegistry.getAdapter(NatsEventAdapter);
    if (natsAdapter?.wsProxyTarget) {
      // Store basePath so the settings endpoint can derive the correct wsUrl
      if (this.basePath) {
        natsAdapter.setWsProxyBasePath(this.basePath);
      }
      attachNatsWsProxy(server, natsAdapter.wsProxyTarget, {
        basePath: this.basePath,
        onWsUrlDerived: (url) => {
          if (!natsAdapter.wsUrl) {
            natsAdapter.setWsUrl(url);
          }
        },
      });
    }
  }

  /**
   * Return a self-contained Express Router that serves:
   * - `/api/*` — Long Tail API routes (auth, tasks, escalations, etc.)
   * - `/health` — health check
   * - Static dashboard assets
   * - SPA fallback with injected `<base href>` and `window.__LT_BASE__`
   */
  getRouter(): Router {
    const router = Router();

    router.use(express.json());

    // Health check
    router.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // API routes — internal routes handle their own JWT auth
    router.use('/api', routes);

    // Dashboard static assets
    const dashboardDist = this.resolveDashboardDist();
    if (dashboardDist) {
      router.use(express.static(dashboardDist, { index: false }));

      // SPA fallback — inject base path into index.html
      const indexHtml = readFileSync(path.join(dashboardDist, 'index.html'), 'utf-8');
      const basePath = this.basePath;

      // Serve __LT_BASE__ as external script (CSP-safe, no inline scripts)
      router.get('/config.js', (_req, res) => {
        res.type('application/javascript').send(`window.__LT_BASE__="${basePath}";`);
      });

      router.get('/{*splat}', (_req, res) => {
        const html = indexHtml.replace(
          '<head>',
          '<head>' +
          `<base href="${basePath}/">` +
          `<script src="./config.js"></script>`,
        );
        res.type('html').send(html);
      });
    }

    return router;
  }

  private resolveDashboardDist(): string | null {
    // Check multiple paths relative to the compiled output location:
    // - Dev (ts-node from repo root): adapters/ -> dashboard/dist
    // - Prod (node build/): build/adapters/ -> dashboard/dist
    // - npm package: node_modules/@hotmeshio/long-tail/build/adapters/ -> dashboard/dist
    const candidates = [
      path.join(__dirname, '..', 'dashboard', 'dist'),
      path.join(__dirname, '..', '..', 'dashboard', 'dist'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
}
