import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';

import { loggerRegistry } from '../logger';
import type { LTEvent, LTEventAdapter } from '../../types';

/**
 * Socket.IO event adapter for browser clients.
 *
 * Publishes LTEvent payloads to all connected Socket.IO clients
 * on channels following the pattern: `lt.events.{event.type}`
 *
 * The HTTP server must be attached via `attachServer()` before
 * `connect()` is called. The startup flow handles this automatically
 * when Socket.IO is the active event transport.
 *
 * Usage:
 * ```typescript
 * import { eventRegistry } from '@hotmeshio/long-tail';
 * import { SocketIOEventAdapter } from '@hotmeshio/long-tail';
 *
 * const adapter = new SocketIOEventAdapter();
 * eventRegistry.register(adapter);
 * // After HTTP server is created:
 * adapter.attachServer(httpServer);
 * await eventRegistry.connect();
 * ```
 */
export class SocketIOEventAdapter implements LTEventAdapter {
  private io: SocketIOServer | null = null;
  private httpServer: HttpServer | null = null;

  /** Attach to an HTTP server. Must be called before connect(). */
  attachServer(server: HttpServer): void {
    this.httpServer = server;
  }

  async connect(): Promise<void> {
    if (!this.httpServer) {
      loggerRegistry.warn('[lt-events:socketio] no HTTP server attached — skipping');
      return;
    }
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      allowEIO3: true,
    });

    this.io.on('connection', (socket) => {
      loggerRegistry.info(`[lt-events:socketio] client connected (${socket.id})`);
      socket.on('disconnect', () => {
        loggerRegistry.debug(`[lt-events:socketio] client disconnected (${socket.id})`);
      });
    });

    loggerRegistry.info('[lt-events:socketio] attached to HTTP server');
  }

  async publish(event: LTEvent): Promise<void> {
    if (!this.io) return;
    const channel = `lt.events.${event.type}`;
    this.io.emit(channel, event);
  }

  async disconnect(): Promise<void> {
    if (this.io) {
      this.io.close();
      this.io = null;
      loggerRegistry.info('[lt-events:socketio] disconnected');
    }
  }
}
