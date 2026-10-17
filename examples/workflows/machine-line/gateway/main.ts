/**
 * The gateway as a process: log in to Long Tail, make sure every machine has
 * its bot account, then join the line's bus and Long Tail's escalation feed.
 */

import { loadMachineLineConfig } from '../../../../services/machines/config';
import { loadLine } from '../line';
import { createEscalationFeed, createMachineBus } from '../../../../services/machines/select';
import type { Actor } from '../../../../services/machines/gateway/actions';
import { MachineGateway } from '../../../../services/machines/gateway/gateway';
import { HttpLineEscalations, LtHttp } from '../../../../services/machines/gateway/lt-http';
import { adminToken, provisionIdentities } from '../../../../services/machines/gateway/provision';

const LOGIN_ATTEMPTS = 30;
const LOGIN_RETRY_MS = 2_000;

/** Long Tail may still be booting; try the login a bounded number of times. */
async function loginWhenReady(http: LtHttp): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await adminToken(http, process.env);
    } catch (err: any) {
      if (attempt >= LOGIN_ATTEMPTS || err?.status !== undefined) throw err;
      await new Promise((r) => setTimeout(r, LOGIN_RETRY_MS));
    }
  }
}

async function main(): Promise<void> {
  // 1. Config and line
  const config = loadMachineLineConfig();
  const line = loadLine(config.lineConfigPath);

  // 2. Identities: one bot per machine plus the controller
  const http = new LtHttp(config.ltBaseUrl);
  const tokens = await provisionIdentities(http, await loginWhenReady(http), line);
  const tokenFor = (as: Actor) => {
    const token = tokens.get(as);
    if (!token) throw new Error(`no Long Tail identity for "${as}" on ${line.siteId}/${line.lineId}`);
    return token;
  };

  // 3. Bus, feed and gateway
  const gateway = new MachineGateway({
    bus: createMachineBus(config, line),
    feed: createEscalationFeed(config, line),
    lt: new HttpLineEscalations(http, tokenFor),
    line,
    settings: {
      topicRoot: config.topicRoot,
      replyTimeoutMs: config.replyTimeoutMs,
      dispatchAttempts: config.dispatchAttempts,
      offlineDebounceMs: config.offlineDebounceMs,
      dispatchTtlMs: config.dispatchTtlMs,
      quietMs: config.quietMs,
    },
  });
  await gateway.start();

  const stop = async () => {
    await gateway.stop();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', event: 'machine_gateway.failed', error: err.message, status: err.status, body: err.body }));
  process.exit(1);
});
