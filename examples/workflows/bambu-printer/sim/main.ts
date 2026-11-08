/**
 * A Bambu printer on the network, simulated: the station named by
 * BAMBU_SIM_STATION, with the serial and access code .env gives it. Its broker
 * (Mosquitto, a separate process on the same host) listens on 8883 for bblp
 * and the access code; this process writes that broker's files, serves the
 * printer's storage over implicit FTPS on 990, plays the printer on the
 * broker's device/<serial>/ topics, and takes drills on BAMBU_SIM_PORT.
 *
 *   BAMBU_SIM_STATION=p1s-01 BAMBU_SIM_DIR=deploy/bambu-sim npx ts-node examples/workflows/bambu-printer/sim/main.ts
 *
 * 1. The broker's certificates, password file and configuration.
 * 2. The printer's storage over FTPS, and the drill server.
 * 3. The printer, on its own broker once that broker is up.
 */

import { connect } from 'mqtt';

import { BAMBU_CHANNEL } from '../codec';
import { PRINTER_ACCESS, printersFromEnv } from '../env';
import { prepareSimBroker } from './broker';
import { startControl } from './control';
import { startFtps, type StoredFile } from './ftps';
import { SimPrinter } from './printer';

const env = process.env;
const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: 'info', event: `bambu_sim.${event}`, ...fields }));

async function main(): Promise<void> {
  const station = env.BAMBU_SIM_STATION || 'p1s-01';
  const printerEnv = printersFromEnv().find((p) => p.station === station);
  if (!printerEnv) throw new Error(`${station} is not in BAMBU_PRINTERS; set BAMBU_SIM_STATION to one that is`);
  const { serial, code } = printerEnv;

  // 1. The broker's files
  const tls = prepareSimBroker(env.BAMBU_SIM_DIR || 'deploy/bambu-sim', { serial, code, mount: env.BAMBU_SIM_MOUNT || '/sim' });

  // 2. Storage and drills
  const stored = new Map<string, StoredFile>();
  const layers = Number(env.BAMBU_SIM_LAYERS || 60);
  const printSec = Number(env.BAMBU_SIM_PRINT_SEC || 60);
  const topic = (channel: string) => `${PRINTER_ACCESS.TOPIC_ROOT}/${serial}/${channel}`;
  let send: (body: Record<string, unknown>) => void = () => undefined;
  const printer = new SimPrinter({ report: (body) => send(body) }, { steps: layers, tickMs: Math.round((printSec * 1000) / layers) });
  await startFtps({ ...tls, code }, stored);
  const port = Number(env.BAMBU_SIM_PORT || 8092);
  await startControl(printer, stored, port);
  log('ready', { station, serial, mqtt: PRINTER_ACCESS.MQTT_PORT, ftps: PRINTER_ACCESS.FTPS_PORT, drills: port, layers, printSec });

  // 3. The printer on its broker
  const client = connect(env.BAMBU_SIM_BROKER_URL || `mqtts://127.0.0.1:${PRINTER_ACCESS.MQTT_PORT}`, {
    username: PRINTER_ACCESS.USER, password: code, protocolVersion: 4, rejectUnauthorized: false, reconnectPeriod: 2_000,
    clientId: `printer-${serial}`,
  });
  send = (body) => client.publish(topic(BAMBU_CHANNEL.REPORT), JSON.stringify(body));
  client.on('connect', () => {
    client.subscribe(topic(BAMBU_CHANNEL.REQUEST));
    log('online', { broker: 'connected' });
  });
  client.on('message', (_topic, payload) => {
    try {
      printer.receive(JSON.parse(payload.toString()));
    } catch (err) {
      log('bad_request', { error: (err as Error).message });
    }
  });
  client.on('error', (err) => log('broker_error', { error: err.message }));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', event: 'bambu_sim.failed', error: err.message }));
  process.exit(1);
});
