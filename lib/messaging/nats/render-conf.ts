/**
 * Long Tail's NATS server, rendered. Accounts keep traffic apart:
 *
 * - LT: Long Tail itself. It owns the durable streams and imports each edge's
 *   subjects, which its streams can then keep.
 * - one edge account per line: the site broker's bridge logs in here (MQTT
 *   only) and may publish its line's subjects and nothing else. The account
 *   exports exactly those subjects, so nothing of Long Tail's is reachable.
 * - SYS: the server's own monitoring.
 *
 * NATS configuration accepts JSON, so accounts are written as JSON.
 */

export interface NatsPermissions {
  publish?: string[] | { allow?: string[]; deny?: string[] };
  subscribe?: string[] | { allow?: string[]; deny?: string[] };
}

export interface NatsUser {
  user: string;
  password?: string;
  permissions?: NatsPermissions;
  allowed_connection_types?: string[];
}

/** A line's edge: who logs in for it, and the subjects it may publish (e.g. `line.v1.site-1.line-1.>`). */
export interface EdgeAccount {
  name: string;
  subjects: string;
  users: NatsUser[];
}

export interface NatsConfOptions {
  serverName: string;
  port?: number;
  httpPort?: number;
  jetstream?: { storeDir: string };
  /** WebSocket listener for browsers; `noAuthUser` maps a connection without credentials to that LT user. */
  websocket?: { port: number; noTls?: boolean; noAuthUser?: string };
  /** MQTT listener for edge bridges; with `tls`, certificates map to users by their subject. */
  mqtt?: { port: number; tls?: { certFile: string; keyFile: string; caFile: string } };
  lt: { users: NatsUser[] };
  edges: EdgeAccount[];
  system?: { user: string; password: string };
}

export const LT_ACCOUNT = 'LT';
export const SYS_ACCOUNT = 'SYS';

function accounts(opts: NatsConfOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [LT_ACCOUNT]: {
      jetstream: opts.jetstream ? 'enabled' : 'disabled',
      users: opts.lt.users,
      imports: opts.edges.map((e) => ({ stream: { account: e.name, subject: e.subjects } })),
    },
  };
  for (const edge of opts.edges) {
    // The edge account has JetStream because NATS keeps MQTT session state there.
    out[edge.name] = { jetstream: opts.jetstream ? 'enabled' : 'disabled', users: edge.users, exports: [{ stream: edge.subjects }] };
  }
  if (opts.system) out[SYS_ACCOUNT] = { users: [opts.system] };
  return out;
}

export function renderNatsConf(opts: NatsConfOptions): string {
  const lines = [
    '# Rendered by Long Tail (lib/messaging/nats/render-conf.ts). Do not edit by hand.',
    `server_name: ${JSON.stringify(opts.serverName)}`,
    `port: ${opts.port ?? 4222}`,
    `http: ${opts.httpPort ?? 8222}`,
  ];
  if (opts.jetstream) lines.push(`jetstream { store_dir: ${JSON.stringify(opts.jetstream.storeDir)} }`);
  if (opts.websocket) {
    const ws = opts.websocket;
    lines.push(`websocket { port: ${ws.port}${ws.noTls ? ', no_tls: true, same_origin: false' : ''}${ws.noAuthUser ? `, no_auth_user: ${JSON.stringify(ws.noAuthUser)}` : ''} }`);
  }
  if (opts.mqtt) {
    const tls = opts.mqtt.tls;
    lines.push(tls
      ? `mqtt { port: ${opts.mqtt.port}, tls { cert_file: ${JSON.stringify(tls.certFile)}, key_file: ${JSON.stringify(tls.keyFile)}, ca_file: ${JSON.stringify(tls.caFile)}, verify_and_map: true, timeout: 5 } }`
      : `mqtt { port: ${opts.mqtt.port} }`);
  }
  lines.push(`accounts: ${JSON.stringify(accounts(opts), null, 2)}`);
  if (opts.system) lines.push(`system_account: ${SYS_ACCOUNT}`);
  return `${lines.join('\n')}\n`;
}
