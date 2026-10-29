/**
 * A Long Tail NATS server with one line's edge account, for the live account
 * test: password logins and a plain MQTT listener stand in for certificates.
 */

import { renderNatsConf } from '../../lib/messaging/nats/render-conf';
import { jsPermissions } from '../../lib/messaging/nats/permissions';
import { edgeAccountFor } from '../../lib/machines/site/edge-account';
import { DEFAULT_LINE } from '../../examples/workflows/machine-line/line';

export const ACCOUNTS = {
  server: { user: 'lt-server', password: 'server-pw' },
  dashboard: { user: 'lt-dashboard', password: 'dashboard-pw' },
  gateway: { user: 'line-gateway', password: 'gateway-pw', durable: 'gw' },
  bridge: { user: 'site-bridge', password: 'bridge-pw' },
  root: 'line/v1',
  stream: 'LINE_EVENTS',
} as const;

export function accountsConf(): string {
  const edge = edgeAccountFor(DEFAULT_LINE, ACCOUNTS.root, ACCOUNTS.bridge.user);
  edge.users[0].password = ACCOUNTS.bridge.password;
  return renderNatsConf({
    serverName: 'lt-accounts-test',
    jetstream: { storeDir: '/data' },
    mqtt: { port: 1883 },
    lt: {
      users: [
        { user: ACCOUNTS.server.user, password: ACCOUNTS.server.password },
        { user: ACCOUNTS.dashboard.user, password: ACCOUNTS.dashboard.password, permissions: { publish: { deny: ['>'] }, subscribe: ['lt.events.>', '_INBOX.>'] } },
        { user: ACCOUNTS.gateway.user, password: ACCOUNTS.gateway.password, permissions: jsPermissions({ streams: [ACCOUNTS.stream], durable: ACCOUNTS.gateway.durable }) },
      ],
    },
    edges: [edge],
    system: { user: 'sys', password: 'sys-pw' },
  });
}

if (require.main === module) process.stdout.write(accountsConf());
