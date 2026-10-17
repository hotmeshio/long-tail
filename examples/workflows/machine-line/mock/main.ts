/**
 * The mock line as a process: one MQTT session per machine, each logged in
 * with its own credentials, plus the drill and payload HTTP server.
 *
 *   MACHINE_TRANSPORT=nats|mqtt MACHINE_MQTT_URL=mqtts://site-nats:8883 \
 *   MACHINE_MQTT_CERT=/certs/{clientId}.pem ... npx ts-node examples/workflows/machine-line/mock/main.ts
 */

import { loadMachineLineConfig } from '../../../../services/machines/config';
import { loadLine } from '../line';
import { createLinkFactory } from '../../../../services/machines/select';
import { startDrillServer } from '../../../../services/machines/testing/mock/drills';
import { MockLine } from '../../../../services/machines/testing/mock/mock-line';
import { mockSettingsFromEnv } from '../../../../services/machines/testing/mock/settings';

async function main(): Promise<void> {
  // 1. Config, line and links
  const config = loadMachineLineConfig({ ...process.env, MACHINE_ESCALATION_FEED: 'memory' });
  const line = loadLine(config.lineConfigPath);
  const settings = mockSettingsFromEnv();
  const port = Number(process.env.MOCK_LINE_PORT ?? 8090);
  const publicUrl = process.env.MOCK_LINE_PUBLIC_URL ?? `http://localhost:${port}`;
  const mock = new MockLine(line, settings, createLinkFactory(config), publicUrl);

  // 2. Machines online, then the drill server
  await mock.start();
  const server = await startDrillServer(mock, port);
  console.log(JSON.stringify({ level: 'info', event: 'mock_line.started', site: line.siteId, line: line.lineId, port, broker: config.mqtt?.url }));

  // 3. Graceful stop drops each will
  const stop = async () => {
    server.close();
    await mock.stop();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', event: 'mock_line.failed', error: err.message }));
  process.exit(1);
});
