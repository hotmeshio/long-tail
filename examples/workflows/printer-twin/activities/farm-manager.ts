/**
 * Farm-manager adapter — THE physical boundary. The broker calls
 * `notifyFarmManager` once per pairing to tell the farm-manager host (e.g. a
 * Windows machine running the vendor's print farm manager) that a physical
 * machine should print now. Backend is env-selected:
 *
 *   FARM_MANAGER_BACKEND=mock  (default) — no host needed. The mock plays the
 *     physical side: it resolves the twin's `printing` row through the public
 *     API, exactly the call the real callback will make.
 *   FARM_MANAGER_BACKEND=http  — POST the job to FARM_MANAGER_BASE_URL. The
 *     request body carries the gcode URL and the callback contract (the
 *     signal key to resolve when the print finishes).
 *
 * Swapping mock → http changes only who makes the resolve call; the durable
 * workflows are untouched.
 */

import { createClient } from '../../../../sdk';

import { OUTCOME_FACETS } from '../types';
import type { PrintDonePayload } from '../types';

export interface FarmManagerJob {
  serialNumber: string;
  model: string;
  jobId: string;
  orderId: string;
  unitIndex: number;
  /** Signed URL the farm manager downloads the gcode from. */
  gcodeUrl: string;
  /** Signal key of the twin's `printing` row — the callback resolves it. */
  printDoneKey: string;
}

export type FarmManagerBackend = 'mock' | 'http';

/** Validate the env selection — unknown backends fail loudly, never fall back. */
export function resolveFarmManagerBackend(env: {
  FARM_MANAGER_BACKEND?: string;
  FARM_MANAGER_BASE_URL?: string;
}): { backend: FarmManagerBackend; baseUrl: string } {
  const backend = env.FARM_MANAGER_BACKEND ?? 'mock';
  if (backend !== 'mock' && backend !== 'http') {
    throw new Error(`unknown FARM_MANAGER_BACKEND "${backend}" — use "mock" or "http"`);
  }
  const baseUrl = env.FARM_MANAGER_BASE_URL ?? '';
  if (backend === 'http' && !baseUrl) {
    throw new Error('FARM_MANAGER_BACKEND=http requires FARM_MANAGER_BASE_URL (e.g. http://farm-host:4000)');
  }
  return { backend, baseUrl };
}

/**
 * The dispatch request the http backend sends. The `callback` block is the
 * contract the farm-manager host fulfills when the print finishes: POST the
 * body to the long-tail API and the twin's `printing` row resolves, waking it.
 */
export function buildFarmManagerRequest(
  baseUrl: string,
  job: FarmManagerJob,
): { url: string; body: Record<string, unknown> } {
  return {
    url: `${baseUrl.replace(/\/$/, '')}/print-jobs`,
    body: {
      serialNumber: job.serialNumber,
      model: job.model,
      jobId: job.jobId,
      orderId: job.orderId,
      unitIndex: job.unitIndex,
      gcodeUrl: job.gcodeUrl,
      callback: {
        method: 'POST',
        path: '/api/escalations/resolve-by-signal-key',
        body: {
          signalKey: job.printDoneKey,
          resolverPayload: { outcome: 'success', reportedBy: 'farm-manager' },
        },
      },
    },
  };
}

export async function notifyFarmManager(input: {
  job: FarmManagerJob;
  /** Operator the MOCK backend resolves the printing row as — a principal
   *  holding the fleet pond role. Unused by the http backend (the real host
   *  authenticates its callback itself). */
  operatorId: string;
}): Promise<{ dispatched: FarmManagerBackend }> {
  const { backend, baseUrl } = resolveFarmManagerBackend(process.env);

  if (backend === 'http') {
    const { url, body } = buildFarmManagerRequest(baseUrl, input.job);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`farm manager dispatch failed (${res.status}) for job ${input.job.jobId}: ${text}`);
    }
    return { dispatched: 'http' };
  }

  await completePhysicalPrintMock(input.job, input.operatorId);
  return { dispatched: 'mock' };
}

/**
 * The mock physical side — does exactly what the real farm-manager callback
 * will do: resolve the twin's `printing` row by signal key through the public
 * API. The twin opens that row right after the handoff wakes it, so the first
 * attempts may 404; retry briefly until it exists.
 */
async function completePhysicalPrintMock(job: FarmManagerJob, operatorId: string): Promise<void> {
  const printSeconds = parseInt(process.env.MOCK_PRINT_SECONDS ?? '1', 10);
  if (printSeconds > 0) await new Promise((r) => setTimeout(r, printSeconds * 1000));

  const lt = createClient({ auth: { userId: operatorId } });
  const payload: PrintDonePayload = { outcome: 'success', reportedBy: 'mock' };

  for (let attempt = 0; attempt < 25; attempt++) {
    const res = await lt.escalations.resolveBySignalKey({
      signalKey: job.printDoneKey,
      resolverPayload: payload,
      metadata: { [OUTCOME_FACETS.OUTCOME]: payload.outcome, [OUTCOME_FACETS.JOB_ID]: job.jobId },
    });
    if (res.status === 200) return;
    // 409 = the row is already terminal — a dashboard operator (or a power-outage
    // sweep) cancelled the machine while it was "printing". The physical side lost
    // the race; the twin already handled the cancel. No-op, exactly as a real
    // farm-manager callback should when it finds the job already gone.
    if (res.status === 409) return;
    if (res.status !== 404) throw new Error(`mock print callback failed (${res.status}): ${res.error ?? ''}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`printing row ${job.printDoneKey} never opened`);
}
