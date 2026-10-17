/**
 * The site broker's configuration, rendered from the line. One NATS server
 * carries JetStream and the MQTT listener; every machine logs in over TLS
 * with its own client certificate (the certificate's CN is its user) and
 * may publish only under its own topics and hear only its own commands.
 * The gateway logs in twice: over MQTT by certificate to send commands, and
 * over NATS by password to read the streams. A leafnode joins Long Tail's
 * NATS, so escalation events and machine subjects share one subject space.
 */

import { controllerId, clientIds, type LineDef } from '../line';
import { CHANNEL, toSubject } from '../protocol';

export interface SiteConfOptions {
  root: string;
  /** Long Tail's NATS leafnode listener, credentials included. */
  hubLeafUrl: string;
  gatewayUser: string;
  gatewayPassword: string;
  certDir: string;
  storeDir: string;
  mqttPort?: number;
}

const q = JSON.stringify;

function machineUser(subjectBase: string, clientId: string, machineId: string): string {
  const own = `${subjectBase}.${machineId}`;
  const cmd = `${own}.${toSubject(CHANNEL.CMD)}`;
  return [
    `    { user: ${q(`CN=${clientId}`)}, allowed_connection_types: ["MQTT"],`,
    `      permissions: { publish: { allow: [${q(`${own}.>`)}], deny: [${q(cmd)}] }, subscribe: { allow: [${q(cmd)}] } } }`,
  ].join('\n');
}

export function renderSiteConf(line: LineDef, opts: SiteConfOptions): string {
  const base = toSubject(`${opts.root}/${line.siteId}/${line.lineId}`);
  const machines = line.machines.map((m, i) => machineUser(base, clientIds(line)[i], m.machineId));
  const controller = [
    `    { user: ${q(`CN=${controllerId(line)}`)}, allowed_connection_types: ["MQTT"],`,
    `      permissions: { publish: [${q(`${base}.*.${toSubject(CHANNEL.CMD)}`)}], subscribe: [${q(`${base}.>`)}] } }`,
  ].join('\n');
  const gateway = `    { user: ${q(opts.gatewayUser)}, password: ${q(opts.gatewayPassword)}, allowed_connection_types: ["STANDARD"] }`;
  return `# Rendered from the line definition by site/setup.ts. Do not edit by hand.
server_name: ${q(`${line.siteId}-${line.lineId}`)}
port: 4222
http: 8222
jetstream { store_dir: ${q(opts.storeDir)} }

authorization {
  users: [
${[...machines, controller, gateway].join('\n')}
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

leafnodes {
  remotes: [ { url: ${q(opts.hubLeafUrl)} } ]
}
`;
}
