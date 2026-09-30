/**
 * A standalone Long Tail process for the restart test: starts, prints
 * `probe-ready`, and answers `call` on stdin with the status of an SDK call.
 */
import { start } from '../../../start';
import { createClient } from '../../../sdk';
import { TEST_DB } from '../../setup/chaos';

async function main(): Promise<void> {
  const lt = await start({
    database: TEST_DB,
    server: { enabled: false },
    seed: { admin: { externalId: 'resilience-probe', displayName: 'Probe', email: 'probe@longtail.local' } },
  });
  const client = createClient({ auth: { userId: lt.adminUserId! } });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (line: string) => {
    if (line.trim() !== 'call') return;
    const result = await client.escalations.list({ limit: 1 });
    process.stdout.write(`probe-status:${result.status}\n`);
  });
  process.stdout.write('probe-ready\n');
}

main().catch((error) => {
  process.stdout.write(`probe-error:${error?.message}\n`);
  process.exit(2);
});
