/**
 * The site's NATS server, rendered from the line. It runs JetStream and an
 * MQTT listener that only the machine broker's bridge logs in to (by client
 * certificate; the CN is its user, and it may publish only under the line's
 * topics). The gateway logs in by password and may only read: the JetStream
 * API, acks and its inbox, and the line's subjects. The site NATS stands
 * alone; Long Tail's escalation events stay inside Long Tail.
 */

import type { LineDef } from '../line';
import { toSubject } from '../protocol';

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

/** What the gateway may publish: JetStream requests, acks and flow control, never a machine subject. */
const GATEWAY_PUBLISH = ['$JS.API.>', '$JS.ACK.>', '$JS.FC.>'];

export function renderSiteConf(line: LineDef, opts: SiteConfOptions): string {
  const base = toSubject(`${opts.root}/${line.siteId}/${line.lineId}`);
  const bridge = [
    `    { user: ${q(`CN=${bridgeId(line)}`)}, allowed_connection_types: ["MQTT"],`,
    `      permissions: { publish: [${q(`${base}.>`)}], subscribe: { deny: [">"] } } }`,
  ].join('\n');
  const gateway = [
    `    { user: ${q(opts.gatewayUser)}, password: ${q(opts.gatewayPassword)}, allowed_connection_types: ["STANDARD"],`,
    `      permissions: { publish: ${q(GATEWAY_PUBLISH)}, subscribe: ${q(['_INBOX.>', `${base}.>`])} } }`,
  ].join('\n');
  return `# Rendered from the line definition by site/setup.ts. Do not edit by hand.
server_name: ${q(`${line.siteId}-${line.lineId}`)}
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
