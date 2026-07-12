/**
 * Bambu client — the physical boundary, env-selected. `BAMBU_BACKEND=mock`
 * (default) drives the in-repo deterministic simulation; `BAMBU_BACKEND=http`
 * talks to a real Farm Manager Server over mTLS (see `bambu-http.ts`), a
 * config-only cutover. The batch executor codes against this interface only, so
 * the twin workflow never changes between mock and real.
 *
 * All real-server specifics come from env — no host, IP, cert path, or
 * credential is ever hardcoded.
 */

import { mockBackend } from './bambu-mock';
import { httpBackend } from './bambu-http';
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

export function getBambuClient(): BambuClient {
  // Importing bambu-http is side-effect-free — cert files and env are read
  // lazily on the first request (via resolveHttpConfig), so a `mock` run never
  // touches them and a missing-env failure surfaces only when `http` is used.
  return resolveBambuBackend(process.env) === 'http' ? httpBackend : mockBackend;
}
