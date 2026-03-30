import { describe, it, expect, afterAll, beforeAll } from 'vitest';

import { start } from '../../start';
import { config, postgres_options } from '../../modules/config';
import { loggerRegistry } from '../../services/logger';
import { telemetryRegistry } from '../../services/telemetry';
import { eventRegistry } from '../../services/events';
import { maintenanceRegistry } from '../../services/maintenance';
import type { LTLoggerAdapter } from '../../types/logger';
import type { LTTelemetryAdapter } from '../../types/telemetry';
import type { LTEventAdapter, LTEvent } from '../../types/events';
import type { LTAuthAdapter } from '../../types/auth';
import type { LTInstance } from '../../types/startup';

// ── Stub adapters ──────────────────────────────────────────────────────────

class StubLogger implements LTLoggerAdapter {
  messages: { level: string; msg: string }[] = [];
  info(msg: string) { this.messages.push({ level: 'info', msg }); }
  warn(msg: string) { this.messages.push({ level: 'warn', msg }); }
  error(msg: string) { this.messages.push({ level: 'error', msg }); }
  debug(msg: string) { this.messages.push({ level: 'debug', msg }); }
}

class StubTelemetry implements LTTelemetryAdapter {
  connected = false;
  disconnected = false;
  async connect() { this.connected = true; }
  async disconnect() { this.disconnected = true; this.connected = false; }
}

class StubEvents implements LTEventAdapter {
  connected = false;
  disconnected = false;
  events: LTEvent[] = [];
  async connect() { this.connected = true; }
  async publish(event: LTEvent) { this.events.push(event); }
  async disconnect() { this.disconnected = true; this.connected = false; }
}

// ── Test config ────────────────────────────────────────────────────────────

const TEST_DB = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: 'longtail_test',
};

const SERVER_PORT = 4567;

function clearRegistries() {
  loggerRegistry.clear();
  telemetryRegistry.clear();
  eventRegistry.clear();
  maintenanceRegistry.clear();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('start() declarative API', () => {

  // ── Adapter registration and config propagation ────────────────────────

  describe('full config: server + adapters', () => {
    let lt: LTInstance;
    const stubLogger = new StubLogger();
    const stubTelemetry = new StubTelemetry();
    const stubEvents = new StubEvents();

    beforeAll(async () => {
      clearRegistries();

      lt = await start({
        database: TEST_DB,
        server: { port: SERVER_PORT },
        auth: { secret: 'test-start-secret' },
        logging: { adapter: stubLogger },
        telemetry: { adapter: stubTelemetry },
        events: { adapters: [stubEvents] },
        maintenance: {
          schedule: '0 4 * * *',
          rules: [
            { target: 'streams', olderThan: '7 days', action: 'delete' },
          ],
        },
      });
    }, 30_000);

    afterAll(async () => {
      await lt.shutdown();
      clearRegistries();
    }, 15_000);

    // ── Return value ──────────────────────────────────────────────────

    it('should return a client and shutdown function', () => {
      expect(lt.client).toBeTruthy();
      expect(typeof lt.shutdown).toBe('function');
    });

    // ── Config propagation ────────────────────────────────────────────

    it('should propagate database config to postgres_options', () => {
      expect(postgres_options.host).toBe(TEST_DB.host);
      expect(postgres_options.port).toBe(TEST_DB.port);
      expect(postgres_options.user).toBe(TEST_DB.user);
    });

    it('should set server port from config', () => {
      expect(config.PORT).toBe(SERVER_PORT);
    });

    it('should set JWT secret from auth.secret', () => {
      expect(config.JWT_SECRET).toBe('test-start-secret');
    });

    // ── Logging adapter ───────────────────────────────────────────────

    it('should register the custom logging adapter', () => {
      expect(loggerRegistry.hasAdapter).toBe(true);
    });

    it('should route startup messages through the logging adapter', () => {
      const startup = stubLogger.messages.find(
        (m) => m.msg.includes('[long-tail] starting'),
      );
      expect(startup).toBeTruthy();
      expect(startup!.level).toBe('info');
    });

    it('should log migration messages through the adapter', () => {
      const migration = stubLogger.messages.find(
        (m) => m.msg.includes('running migrations'),
      );
      expect(migration).toBeTruthy();
    });

    // ── Telemetry adapter ─────────────────────────────────────────────

    it('should register the telemetry adapter', () => {
      expect(telemetryRegistry.hasAdapter).toBe(true);
    });

    // ── Event adapters ────────────────────────────────────────────────

    it('should register event adapters', () => {
      expect(eventRegistry.hasAdapters).toBe(true);
    });

    // ── Maintenance ───────────────────────────────────────────────────

    it('should register maintenance config with the correct schedule', () => {
      expect(maintenanceRegistry.hasConfig).toBe(true);
      expect(maintenanceRegistry.config?.schedule).toBe('0 4 * * *');
      expect(maintenanceRegistry.config?.rules).toHaveLength(1);
      expect(maintenanceRegistry.config?.rules[0].target).toBe('streams');
    });

    // ── Embedded server ───────────────────────────────────────────────

    it('should respond to GET /health', async () => {
      const res = await fetch(`http://localhost:${SERVER_PORT}/health`);
      expect(res.ok).toBe(true);
      const body = await res.json() as any;
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeTruthy();
    });

    it('should mount API routes (401 without auth)', async () => {
      const res = await fetch(`http://localhost:${SERVER_PORT}/api/tasks`);
      expect(res.status).toBe(401);
    });

    it('should mount cron status route (401 without auth)', async () => {
      const res = await fetch(`http://localhost:${SERVER_PORT}/api/workflows/cron/status`);
      expect(res.status).toBe(401);
    });

    it('should return cron schedules with valid auth', async () => {
      const { signToken } = await import('../../modules/auth');
      const token = signToken({ userId: 'test-admin', role: 'admin' });
      const res = await fetch(`http://localhost:${SERVER_PORT}/api/workflows/cron/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('schedules');
      expect(Array.isArray(body.schedules)).toBe(true);
    });
  });

  // ── Maintenance disabled ───────────────────────────────────────────────

  describe('maintenance control', () => {
    it('should not register maintenance when set to false', async () => {
      clearRegistries();

      const lt = await start({
        database: TEST_DB,
        server: { enabled: false },
        maintenance: false,
      });

      expect(maintenanceRegistry.hasConfig).toBe(false);

      await lt.shutdown();
      clearRegistries();
    }, 30_000);

    it('should register default maintenance when omitted', async () => {
      clearRegistries();

      const lt = await start({
        database: TEST_DB,
        server: { enabled: false },
        // maintenance not specified — defaults to true
      });

      expect(maintenanceRegistry.hasConfig).toBe(true);
      expect(maintenanceRegistry.config?.schedule).toBe('0 2 * * *');
      expect(maintenanceRegistry.config?.rules.length).toBeGreaterThanOrEqual(4);

      await lt.shutdown();
      clearRegistries();
    }, 30_000);

    it('should register default maintenance when set to true', async () => {
      clearRegistries();

      const lt = await start({
        database: TEST_DB,
        server: { enabled: false },
        maintenance: true,
      });

      expect(maintenanceRegistry.hasConfig).toBe(true);
      expect(maintenanceRegistry.config?.schedule).toBe('0 2 * * *');

      await lt.shutdown();
      clearRegistries();
    }, 30_000);
  });

  // ── Custom auth adapter ────────────────────────────────────────────────

  describe('custom auth adapter via start() config', () => {
    let lt: LTInstance;
    let adapterCallCount = 0;

    const customAuth: LTAuthAdapter = {
      authenticate: () => {
        adapterCallCount++;
        return { userId: 'custom-user', role: 'tester' };
      },
    };

    beforeAll(async () => {
      clearRegistries();

      lt = await start({
        database: TEST_DB,
        server: { port: SERVER_PORT + 1 },
        auth: { adapter: customAuth },
        maintenance: false,
      });
    }, 30_000);

    afterAll(async () => {
      await lt.shutdown();
      clearRegistries();
    }, 15_000);

    it('should wire the custom adapter into the embedded server', async () => {
      const res = await fetch(`http://localhost:${SERVER_PORT + 1}/api/tasks`);

      // Custom adapter always returns a valid payload → request passes auth
      expect(res.status).not.toBe(401);
      expect(adapterCallCount).toBeGreaterThan(0);
    });
  });

  // ── Shutdown lifecycle ─────────────────────────────────────────────────

  describe('shutdown lifecycle', () => {
    it('should stop the server and disconnect adapters on shutdown', async () => {
      clearRegistries();

      const stubLogger = new StubLogger();
      const stubEvents = new StubEvents();
      const stubTelemetry = new StubTelemetry();

      const lt = await start({
        database: TEST_DB,
        server: { port: SERVER_PORT + 2 },
        logging: { adapter: stubLogger },
        events: { adapters: [stubEvents] },
        telemetry: { adapter: stubTelemetry },
        maintenance: false,
      });

      // Server should be running
      const before = await fetch(`http://localhost:${SERVER_PORT + 2}/health`);
      expect(before.ok).toBe(true);

      // Shutdown
      await lt.shutdown();

      // Server should be stopped
      try {
        await fetch(`http://localhost:${SERVER_PORT + 2}/health`);
        expect.fail('Expected fetch to fail after shutdown');
      } catch {
        // Expected — connection refused
      }

      // Shutdown message logged
      const shutdownMsg = stubLogger.messages.find(
        (m) => m.msg.includes('shutting down'),
      );
      expect(shutdownMsg).toBeTruthy();

      // Completion message logged
      const completeMsg = stubLogger.messages.find(
        (m) => m.msg.includes('shutdown complete'),
      );
      expect(completeMsg).toBeTruthy();

      // Event adapter disconnected
      expect(stubEvents.disconnected).toBe(true);

      // Telemetry adapter disconnected
      expect(stubTelemetry.disconnected).toBe(true);

      clearRegistries();
    }, 30_000);
  });

  // ── Server disabled ────────────────────────────────────────────────────

  describe('server: { enabled: false }', () => {
    let lt: LTInstance;

    beforeAll(async () => {
      clearRegistries();

      lt = await start({
        database: TEST_DB,
        server: { enabled: false, port: SERVER_PORT + 3 },
        maintenance: false,
      });
    }, 30_000);

    afterAll(async () => {
      await lt.shutdown();
      clearRegistries();
    }, 15_000);

    it('should return a client even without a server', () => {
      expect(lt.client).toBeTruthy();
    });

    it('should not start an HTTP listener', async () => {
      try {
        await fetch(`http://localhost:${SERVER_PORT + 3}/health`);
        expect.fail('Expected fetch to fail — no server should be listening');
      } catch {
        // Expected — nothing listening on this port
      }
    });

    it('should still shut down cleanly', async () => {
      // Shutdown should not throw even with no server to close
      await expect(lt.shutdown()).resolves.not.toThrow();
    });
  });
});
