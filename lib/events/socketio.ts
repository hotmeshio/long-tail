import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';

import { loggerRegistry } from '../logger';
import { subjectMatchesPattern } from './matching';
import type { LTEvent, LTEventAdapter } from '../../types';

/**
 * Callback to verify a Socket.IO handshake token.
 * Return `true` to allow the connection, `false` to reject.
 */
export type SocketIOAuthenticator = (token: string) => boolean | Promise<boolean>;

/**
 * Socket.IO event adapter for browser clients.
 *
 * Publishes LTEvent payloads to connected Socket.IO clients on channels
 * following the pattern: `lt.events.{event.type}`.
 *
 * Delivery is scoped per socket: a client registers NATS-style subject
 * patterns with `lt.subscribe` / `lt.unsubscribe` messages and receives only
 * matching events — the server filters, the wire carries only what the page
 * asked for. A socket that never registers a pattern receives every event
 * (the broadcast contract external consumers may rely on).
 *
 * The HTTP server must be attached via `attachServer()` before
 * `connect()` is called. The startup flow handles this automatically
 * when Socket.IO is the active event transport.
 *
 * When an `authenticate` callback is provided, Socket.IO middleware
 * rejects handshakes that do not include a valid `auth.token`.
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
  private authenticate: SocketIOAuthenticator | null;
  private socketPath = '/socket.io';

  constructor(options?: { authenticate?: SocketIOAuthenticator }) {
    this.authenticate = options?.authenticate ?? null;
  }

  /** Attach to an HTTP server. Must be called before connect(). */
  attachServer(server: HttpServer): void {
    this.httpServer = server;
  }

  /** Override the socket.io path (for subpath-mounted deployments). */
  setPath(socketPath: string): void {
    this.socketPath = socketPath;
  }

  async connect(): Promise<void> {
    if (!this.httpServer) {
      loggerRegistry.warn('[lt-events:socketio] no HTTP server attached — skipping');
      return;
    }
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
      path: this.socketPath,
      transports: ['polling', 'websocket'],
      allowEIO3: true,
    });

    if (this.authenticate) {
      const verify = this.authenticate;
      this.io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) {
          return next(new Error('Authentication required'));
        }
        try {
          const valid = await verify(token);
          if (!valid) {
            return next(new Error('Authentication failed'));
          }
          next();
        } catch {
          next(new Error('Authentication failed'));
        }
      });
    }

    this.io.on('connection', (socket) => {
      loggerRegistry.info(`[lt-events:socketio] client connected (${socket.id})`);
      // Per-socket subject-pattern scope. Registering the first pattern
      // switches the socket from broadcast to scoped delivery.
      const patterns = new Set<string>();
      socket.data.ltPatterns = patterns;
      socket.on('lt.subscribe', (pattern: unknown) => {
        if (typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 256) {
          patterns.add(pattern);
        }
      });
      socket.on('lt.unsubscribe', (pattern: unknown) => {
        if (typeof pattern === 'string') patterns.delete(pattern);
      });
      socket.on('disconnect', () => {
        loggerRegistry.debug(`[lt-events:socketio] client disconnected (${socket.id})`);
      });
    });

    loggerRegistry.info('[lt-events:socketio] attached to HTTP server');
  }

  async publish(event: LTEvent): Promise<void> {
    if (!this.io) return;
    const channel = `lt.events.${event.type}`;
    for (const socket of this.io.of('/').sockets.values()) {
      const patterns = socket.data.ltPatterns as Set<string> | undefined;
      if (!patterns || patterns.size === 0) {
        // Legacy scope: a socket with no registered patterns gets everything.
        socket.emit(channel, event);
        continue;
      }
      for (const pattern of patterns) {
        if (subjectMatchesPattern(channel, pattern)) {
          socket.emit(channel, event);
          break;
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.io) {
      this.io.close();
      this.io = null;
      loggerRegistry.info('[lt-events:socketio] disconnected');
    }
  }
}
