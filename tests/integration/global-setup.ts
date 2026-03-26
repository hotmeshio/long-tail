/**
 * Global setup for integration tests.
 *
 * Polls the Docker-hosted app's health endpoint until it responds,
 * ensuring services (Postgres, NATS, app) are ready before tests run.
 */

const BASE_URL = process.env.LT_BASE_URL || 'http://localhost:3000';
const HEALTH_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

export async function setup() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = '';

  process.stdout.write(`[integration] Waiting for ${BASE_URL}/health ...`);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        process.stdout.write(' ready\n');
        return;
      }
      lastError = `status ${res.status}`;
    } catch (err: any) {
      lastError = err.code || err.message;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Docker services did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s (last: ${lastError})`,
  );
}
