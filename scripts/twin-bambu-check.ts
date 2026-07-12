/**
 * twin-bambu-check — last-mile smoke test of the `http` Bambu backend.
 *
 * Drives ONE real 30-second print cycle against a Farm Manager Server (or the
 * Python mock) through the exact BambuClient the twin uses — with no database,
 * no workflow engine, no HotMesh. Proves the plumbing end to end: mTLS + forced
 * SNI + login + bind → uploadAndPrint → poll-confirmed FINISH → bed_clean →
 * unbind. If this is green, the twin workflow will drive the same client.
 *
 * Runs on the HOST, so it resolves the handoff certs at repo-relative paths
 * (not the in-container /app paths the app service uses).
 *
 * Usage:
 *   npm run twin:bambu-check                          # MOCKP1S0000001, success
 *   SN=MOCKP1S0000002 npm run twin:bambu-check
 *   ARM=filament_runout npm run twin:bambu-check       # arm a fault first (mock /sim)
 *   BAMBU_BASE_URL=https://192.168.86.222:8443 npm run twin:bambu-check
 */

import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import * as https from 'node:https';

try { require('dotenv/config'); } catch { /* optional */ }

const CERTS = resolve(__dirname, '../examples/workflows/printer-twin/bambu_config/farm_demo/certs');
// Point the backend at host-side cert paths before it reads env lazily.
process.env.BAMBU_BASE_URL ||= 'https://192.168.86.222:8443';
process.env.BAMBU_CLIENT_CERT = resolve(CERTS, 'local_client.crt');
process.env.BAMBU_CLIENT_KEY = resolve(CERTS, 'local_client.key');
process.env.BAMBU_CA_CERT = resolve(CERTS, 'root-ca.crt');
process.env.BAMBU_SERVERNAME ||= 'farm_server.bambulab.com';
process.env.BAMBU_ADMIN_USER ||= 'admin';
process.env.BAMBU_ADMIN_PASS ||= 'qwer1234';

import { httpBackend } from '../examples/workflows/printer-twin/activities/bambu-http';

const SN = process.env.SN || 'MOCKP1S0000001';
const ARM = process.env.ARM as 'success' | 'failed' | 'filament_runout' | undefined;
const BASE = new URL(process.env.BAMBU_BASE_URL!);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (m: string) => console.log(`[${ts()}] ${m}`);

/** Direct mTLS POST for the mock's test-control /sim/* endpoints (no auth). */
function sim(path: string, body: unknown): Promise<number> {
  const payload = Buffer.from(JSON.stringify(body));
  const agent = new https.Agent({
    cert: readFileSync(process.env.BAMBU_CLIENT_CERT!),
    key: readFileSync(process.env.BAMBU_CLIENT_KEY!),
    ca: readFileSync(process.env.BAMBU_CA_CERT!),
    servername: process.env.BAMBU_SERVERNAME,
    rejectUnauthorized: true,
  });
  return new Promise((res, rej) => {
    const req = https.request(
      { agent, method: 'POST', hostname: BASE.hostname, port: BASE.port, path, servername: process.env.BAMBU_SERVERNAME, headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } },
      (r) => { r.on('data', () => {}); r.on('end', () => res(r.statusCode ?? 0)); },
    );
    req.on('error', rej);
    req.write(payload);
    req.end();
  });
}

async function pollUntil(predicate: (state: string, pct: number) => boolean, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const r = await httpBackend.pollDevice(SN);
    if (!r.ok) {
      log(`  poll → ${r.error}`);
      if (r.error === 'unbound') { await sleep(1500); continue; }
    } else {
      const { gcode_state, mc_percent } = r.snapshot.reportStatus;
      if (gcode_state !== last) { log(`  ${gcode_state} (${mc_percent}%)`); last = gcode_state; }
      if (predicate(gcode_state, mc_percent)) return gcode_state;
    }
    await sleep(2000);
  }
  return last || 'TIMEOUT';
}

async function main() {
  log(`Bambu http smoke — ${SN} @ ${BASE.host} (arm=${ARM ?? 'default success'})`);

  if (ARM) {
    const code = await sim(`/sim/${SN}/arm_outcome`, { outcome: ARM, after_seconds: 30 });
    log(`armed ${ARM} (HTTP ${code})`);
  }

  log('bind…');
  await httpBackend.bind(SN);
  await pollUntil((s) => s === 'IDLE', 15_000);

  log('uploadAndPrint…');
  await httpBackend.uploadAndPrint(SN, {
    jobId: `smoke-${Date.now()}`, orderId: 'smoke', unitIndex: 0, gcodeUrl: 'placeholder',
    callbackKey: 'cb', printDoneKey: 'pd', brokerWorkflowId: 'bw',
  });

  const terminal = await pollUntil((s) => s === 'FINISH' || s === 'FAILED' || s === 'PAUSE', 60_000);
  log(`print terminal: ${terminal}`);

  if (terminal === 'FINISH' || terminal === 'FAILED') {
    log('bed_clean…');
    await httpBackend.opt(SN, 'bed_clean');
    await pollUntil((s) => s === 'IDLE', 15_000);
  }

  log('unbind…');
  await httpBackend.unbind(SN);

  const ok = terminal === 'FINISH' || (ARM === 'failed' && terminal === 'FAILED') || (ARM === 'filament_runout' && terminal === 'PAUSE');
  log(ok ? '✓ smoke PASSED' : `✗ smoke ended in ${terminal}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error('✗ smoke FAILED:', err?.message ?? err); process.exit(1); });
