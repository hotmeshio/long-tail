/**
 * Bambu client — the physical boundary, env-selected. `BAMBU_BACKEND=mock`
 * (default) drives the in-repo deterministic simulation; `BAMBU_BACKEND=http`
 * talks to a real Farm Manager Server over mTLS (built next pass, config-only
 * cutover). The batch executor codes against this interface only, so the twin
 * workflow never changes between mock and real.
 *
 * All real-server specifics come from env — no host, IP, cert path, or
 * credential is ever hardcoded.
 */

import { mockBackend } from './bambu-mock';
import type { BambuPollResult } from '../mirror';
import type { TwinJobPayload } from '../types';

export interface BambuClient {
  /** Onboard a discovered printer (PUT /sdk/device/bind). */
  bind(sn: string, model?: string): Promise<void>;
  /** Decommission a printer (DELETE /bind). */
  unbind(sn: string): Promise<void>;
  /** Ground-truth poll (GET /device/{sn}). `unbound` ≠ error; `transport` ≠ offline. */
  pollDevice(sn: string): Promise<BambuPollResult>;
  /** Printer op (POST /device/{sn}/opt) — pause/resume/stop/bed_clean, guarded. */
  opt(sn: string, opt: 'pause' | 'resume' | 'stop' | 'bed_clean'): Promise<void>;
  /** Push the file and start the print (PUT /device/{sn}/print, multipart). */
  uploadAndPrint(sn: string, job: TwinJobPayload): Promise<void>;
}

export type BambuBackend = 'mock' | 'http';

/** Validate the backend selection — unknown values fail loud, never fall back. */
export function resolveBambuBackend(env: { BAMBU_BACKEND?: string }): BambuBackend {
  const backend = env.BAMBU_BACKEND ?? 'mock';
  if (backend !== 'mock' && backend !== 'http') {
    throw new Error(`unknown BAMBU_BACKEND "${backend}" — use "mock" or "http"`);
  }
  return backend;
}

const HTTP_ENV = ['BAMBU_BASE_URL', 'BAMBU_CLIENT_CERT', 'BAMBU_CLIENT_KEY', 'BAMBU_CA_CERT', 'BAMBU_SERVERNAME', 'BAMBU_ADMIN_USER', 'BAMBU_ADMIN_PASS'];

/**
 * The http backend arrives next pass — a `node:https` Agent presenting the
 * client cert/key + custom CA with a forced SNI, wrapping the Farm Manager API.
 * Until then it fails loud, naming exactly what it will need, so a premature
 * `BAMBU_BACKEND=http` never silently no-ops.
 */
function httpBackendStub(): never {
  throw new Error(
    `BAMBU_BACKEND=http is not wired yet (next pass). It will read: ${HTTP_ENV.join(', ')}. ` +
      'Use BAMBU_BACKEND=mock for now.',
  );
}

const httpBackend: BambuClient = {
  bind: httpBackendStub,
  unbind: httpBackendStub,
  pollDevice: httpBackendStub,
  opt: httpBackendStub,
  uploadAndPrint: httpBackendStub,
};

export function getBambuClient(): BambuClient {
  return resolveBambuBackend(process.env) === 'http' ? httpBackend : mockBackend;
}
