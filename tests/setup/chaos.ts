import { Client } from 'pg';

/**
 * Connection faults against the test database, driven by an admin client on
 * the `postgres` maintenance database so it stays usable while the test
 * database refuses connections.
 */

export const TEST_DATABASE = 'longtail_test';

export const TEST_DB = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5415', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: TEST_DATABASE,
};

async function withAdmin<T>(fn: (admin: Client) => Promise<T>): Promise<T> {
  const admin = new Client({ ...TEST_DB, database: 'postgres' });
  admin.on('error', () => undefined);
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/** Terminate every backend of the test database (57P01, as a server restart). */
export async function terminateBackends(): Promise<number> {
  return withAdmin(async (admin) => {
    const result = await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [TEST_DATABASE],
    );
    return result.rowCount ?? 0;
  });
}

/** Refuse every new connection to the test database, then drop the live ones. */
export async function beginOutage(): Promise<void> {
  await withAdmin((admin) => admin.query(`ALTER DATABASE "${TEST_DATABASE}" WITH ALLOW_CONNECTIONS false`));
  await terminateBackends();
}

export async function endOutage(): Promise<void> {
  await withAdmin((admin) => admin.query(`ALTER DATABASE "${TEST_DATABASE}" WITH ALLOW_CONNECTIONS true`));
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label = 'condition',
  intervalMs = 100,
): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) return Date.now() - startedAt;
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

/** Records every uncaught exception and unhandled rejection while installed. */
export function createCrashGuard() {
  const crashes: unknown[] = [];
  const onCrash = (error: unknown) => {
    crashes.push(error);
  };
  return {
    crashes,
    install: () => {
      process.on('uncaughtException', onCrash);
      process.on('unhandledRejection', onCrash);
    },
    uninstall: () => {
      process.off('uncaughtException', onCrash);
      process.off('unhandledRejection', onCrash);
    },
  };
}
