/**
 * The machine broker (Mosquitto), rendered from the line. Machines speak
 * MQTT 5 to it over TLS, each with its own client certificate (the CN is
 * its username). The ACL lets a machine publish only its own channels and
 * read only its own commands, and lets the line controller command every
 * machine on the line. A bridge carries the line's topics out to the site
 * NATS, where JetStream keeps them.
 */

import { clientIdOf } from '../protocol/envelope';
import { CHANNEL } from '../protocol/constants';
import { controllerId, identOf, type LineDef } from '../line';
import { bridgeId } from './site-conf';

export interface MosquittoConfOptions {
  root: string;
  /** Certificate directory as the broker sees it. */
  certDir: string;
  /** Where the site NATS MQTT listener is, host:port. */
  siteNats: string;
  aclFile: string;
  maxPacketBytes?: number;
}

/** What a machine may publish: its own channels and nothing it does not own. */
const MACHINE_WRITES = [
  CHANNEL.PRESENCE, CHANNEL.SNAPSHOT, CHANNEL.JOB, `${CHANNEL.ALARM}/+`, CHANNEL.TELEMETRY, CHANNEL.REPLY, `${CHANNEL.REPORT}/#`,
];

export function renderMosquittoConf(line: LineDef, opts: MosquittoConfOptions): string {
  return `# Rendered from the line definition by site/setup.ts. Do not edit by hand.
persistence true
persistence_location /mosquitto/data/
log_dest stdout
log_type error
log_type warning
log_type notice

listener 8883
cafile ${opts.certDir}/ca.pem
certfile ${opts.certDir}/broker.pem
keyfile ${opts.certDir}/broker.key
require_certificate true
use_identity_as_username true
acl_file ${opts.aclFile}
max_packet_size ${opts.maxPacketBytes ?? 262_144}

connection ${line.siteId}-${line.lineId}-site-nats
address ${opts.siteNats}
bridge_protocol_version mqttv311
bridge_cafile ${opts.certDir}/ca.pem
bridge_certfile ${opts.certDir}/${bridgeId(line)}.pem
bridge_keyfile ${opts.certDir}/${bridgeId(line)}.key
remote_clientid ${bridgeId(line)}
cleansession false
try_private false
notifications false
topic ${opts.root}/${line.siteId}/${line.lineId}/# out 1
`;
}

export function renderMosquittoAcl(line: LineDef, root: string): string {
  const base = `${root}/${line.siteId}/${line.lineId}`;
  const machines = line.machines.map((m) => {
    const own = `${base}/${m.machineId}`;
    return [
      `user ${clientIdOf(identOf(line, m.machineId))}`,
      ...MACHINE_WRITES.map((c) => `topic write ${own}/${c}`),
      `topic read ${own}/${CHANNEL.CMD}`,
    ].join('\n');
  });
  const controller = [`user ${controllerId(line)}`, `topic write ${base}/+/${CHANNEL.CMD}`, `topic read ${base}/#`].join('\n');
  return `# Rendered from the line definition by site/setup.ts. Do not edit by hand.\n\n${[...machines, controller].join('\n\n')}\n`;
}
