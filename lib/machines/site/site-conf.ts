/**
 * The site's NATS server, rendered from its lines. It runs JetStream and an
 * MQTT listener that only the machine broker's bridge logs in to (by client
 * certificate; the CN is its user, and it may publish only under the line's
 * topics). The gateway logs in by password and may only keep and read the
 * line's streams through its own consumer (it can neither publish a machine
 * subject nor delete a stream), and subscribe to its inbox and the line. The
 * site NATS stands alone; Long Tail's escalation events stay inside Long Tail.
 */

import { controllerId, type LineDef } from '../line';
import { toSubject } from '../protocol';
import { jsPermissions } from '../../messaging/nats/permissions';
import { LINE_STREAM } from '../transport/streams';

export interface SiteConfOptions {
  root: string;
  gatewayUser: string;
  gatewayPassword: string;
  certDir: string;
  storeDir: string;
  mqttPort?: number;
}

const q = JSON.stringify;

/** The machine broker's bridge identity for a line. */
export function bridgeId(line: LineDef): string {
  return `${line.siteId}-${line.lineId}-bridge`;
}

/** What the gateway may publish: its streams' and its consumer's JetStream requests and acks, never a machine subject. */
export function gatewayPublish(line: LineDef): string[] {
  return jsPermissions({ streams: Object.values(LINE_STREAM), durable: `${controllerId(line)}-events` }).publish;
}

/** One line, or every line the site runs. */
export type Lines = LineDef | LineDef[];

export function linesOf(lines: Lines): LineDef[] {
  return Array.isArray(lines) ? lines : [lines];
}

/** The server's name: the line for one line, the site when every line shares it, `site` otherwise. */
function serverName(lines: LineDef[]): string {
  if (lines.length === 1) return `${lines[0].siteId}-${lines[0].lineId}`;
  const sites = new Set(lines.map((l) => l.siteId));
  return sites.size === 1 ? lines[0].siteId : 'site';
}

/**
 * The site NATS for one line or several: one bridge user per line, one
 * gateway user allowed every line's streams and subjects.
 */
export function renderSiteConf(lines: Lines, opts: SiteConfOptions): string {
  const list = linesOf(lines);
  if (!list.length) throw new Error('renderSiteConf needs at least one line');
  const baseOf = (line: LineDef) => toSubject(`${opts.root}/${line.siteId}/${line.lineId}`);
  const bridge = list.map((line) => [
    `    { user: ${q(`CN=${bridgeId(line)}`)}, allowed_connection_types: ["MQTT"],`,
    `      permissions: { publish: [${q(`${baseOf(line)}.>`)}], subscribe: { deny: [">"] } } }`,
  ].join('\n')).join('\n');
  const publish = [...new Set(list.flatMap((line) => gatewayPublish(line)))];
  const gateway = [
    `    { user: ${q(opts.gatewayUser)}, password: ${q(opts.gatewayPassword)}, allowed_connection_types: ["STANDARD"],`,
    `      permissions: { publish: ${q(publish)}, subscribe: ${q(['_INBOX.>', ...list.map((line) => `${baseOf(line)}.>`)])} } }`,
  ].join('\n');
  return `# Rendered from the line definition by site/setup.ts. Do not edit by hand.
server_name: ${q(serverName(list))}
port: 4222
http: 8222
jetstream { store_dir: ${q(opts.storeDir)} }

authorization {
  users: [
${bridge}
${gateway}
  ]
}

mqtt {
  port: ${opts.mqttPort ?? 8883}
  tls {
    cert_file: ${q(`${opts.certDir}/server.pem`)}
    key_file: ${q(`${opts.certDir}/server.key`)}
    ca_file: ${q(`${opts.certDir}/ca.pem`)}
    verify_and_map: true
    timeout: 5
  }
}
`;
}
