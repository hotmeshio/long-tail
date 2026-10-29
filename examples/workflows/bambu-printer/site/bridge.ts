/**
 * One Mosquitto bridge per printer. A Bambu printer hosts its own MQTT broker
 * (port 8883, user bblp, its access code as the password), so the site broker
 * connects out to it: the printer's report comes in and the line's requests
 * go out, both under the printer's level of the line's topics. The bridge's
 * own state (1 or 0), kept on the site broker, says whether the printer is
 * reachable. The printer's certificate is issued to its serial, not its
 * address, so the bridge checks the chain against the printer's CA and skips
 * the host name.
 */

import type { LineDef } from '../../../../types/machines';
import { BAMBU_CHANNEL } from '../codec';
import { PRINTER_ACCESS, type BambuPrinter } from '../env';

/** The printer's CA certificate file, as the broker sees it. */
export const printerCaFile = (certDir: string, serial: string) => `${certDir}/bambu-ca-${serial}.pem`;

export function renderPrinterBridge(line: LineDef, printer: BambuPrinter, opts: { root: string; certDir: string }): string {
  const local = `${opts.root}/${line.siteId}/${line.lineId}/${printer.serial}/`;
  const remote = `${PRINTER_ACCESS.TOPIC_ROOT}/${printer.serial}/`;
  return `connection ${line.siteId}-${line.lineId}-${printer.station}
address ${printer.host}:${PRINTER_ACCESS.MQTT_PORT}
bridge_protocol_version mqttv311
bridge_cafile ${printerCaFile(opts.certDir, printer.serial)}
bridge_insecure true
remote_username ${PRINTER_ACCESS.USER}
remote_password ${printer.code}
remote_clientid line-bridge-${line.siteId}-${line.lineId}-${printer.station}
cleansession true
try_private false
notifications true
notifications_local_only true
notification_topic ${local}${BAMBU_CHANNEL.BRIDGE}
topic ${BAMBU_CHANNEL.REPORT} in 0 ${local} ${remote}
topic ${BAMBU_CHANNEL.REQUEST} out 0 ${local} ${remote}
`;
}

/** Bridges for the printers on the line. */
export function renderPrinterBridges(line: LineDef, printers: BambuPrinter[], opts: { root: string; certDir: string }): string {
  const onLine = new Set(line.machines.map((m) => m.machineId));
  return printers.filter((p) => onLine.has(p.station)).map((p) => renderPrinterBridge(line, p, opts)).join('\n');
}
