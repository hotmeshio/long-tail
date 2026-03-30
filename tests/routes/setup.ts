import { beforeAll, afterAll } from 'vitest';

import { start } from '../../start';
import { signToken } from '../../modules/auth';
import { loggerRegistry } from '../../services/logger';
import { telemetryRegistry } from '../../services/telemetry';
import { eventRegistry } from '../../services/events';
import { maintenanceRegistry } from '../../services/maintenance';
import type { LTInstance } from '../../types/startup';
import type { LTStartConfig } from '../../types/startup';

const TEST_DB = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: 'longtail_test',
};

const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000001';
const MEMBER_USER_ID = '00000000-0000-0000-0000-000000000002';

function clearRegistries() {
  loggerRegistry.clear();
  telemetryRegistry.clear();
  eventRegistry.clear();
  maintenanceRegistry.clear();
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * Boot a test server on the given port and return helpers.
 * Each test file gets its own port to avoid conflicts.
 */
export function setupRouteTest(port: number, startOverrides?: Partial<LTStartConfig>) {
  let lt: LTInstance;
  let adminToken: string;
  let memberToken: string;
  const BASE = `http://localhost:${port}/api`;

  beforeAll(async () => {
    clearRegistries();
    lt = await start({
      database: TEST_DB,
      server: { port },
      auth: { secret: 'route-test-secret' },
      ...startOverrides,
    } as LTStartConfig);
    adminToken = signToken({ userId: ADMIN_USER_ID, role: 'admin' });
    memberToken = signToken({ userId: MEMBER_USER_ID, role: 'member' });
  }, 30_000);

  afterAll(async () => {
    await lt.shutdown();
    clearRegistries();
  }, 15_000);

  return {
    get BASE() { return BASE; },
    get adminToken() { return adminToken; },
    get memberToken() { return memberToken; },
  };
}
