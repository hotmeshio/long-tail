/**
 * Kitchen Sink Workflow
 *
 * Demonstrates every Durable primitive in one workflow:
 *
 *   1. proxyActivities  — turn functions into durable, checkpointed steps
 *   2. Activity calls   — each call is cached on replay (deterministic)
 *   3. Sleep            — durable timer that survives process crashes
 *   4. Parallel calls   — Promise.all with multiple activities
 *   5. waitFor          — pause until an external signal arrives
 *   6. Conditional flow — branch based on signal data
 *
 * Use this as a copy-paste starting point for your own workflows.
 *
 * Structure:
 *   examples/workflows/kitchen-sink/
 *   ├── activities.ts     ← side-effect functions (API calls, DB writes, etc.)
 *   ├── index.ts          ← this file (the workflow — must be deterministic)
 *   └── orchestrator.ts   ← entry point wrapper using executeLT
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import * as activities from './activities';

// ── Proxy activities ────────────────────────────────────────────────────────
// This turns each function in activities.ts into a durable checkpoint.
// The proxy must be created at module scope (not inside the workflow function).

type ActivitiesType = typeof activities;

const { greet, fetchData, transformData, notifyComplete } =
  Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
    retryPolicy: {
      maximumAttempts: 3,
      backoffCoefficient: 2,
      maximumInterval: '10 seconds',
    },
  });

// ── Workflow function ───────────────────────────────────────────────────────

export async function kitchenSink(envelope: LTEnvelope): Promise<any> {
  const { name = 'World', mode = 'full' } = envelope.data;

  // ── 1. Activity call ──────────────────────────────────────────────────
  // Each proxied call is a durable checkpoint. If the process crashes after
  // this completes, the cached result is replayed — the function isn't re-run.
  const greeting = await greet(name);

  // ── 2. Durable sleep ──────────────────────────────────────────────────
  // Survives crashes. If the process restarts during the sleep, it resumes
  // where it left off — no drift, no double-execution.
  await Durable.workflow.sleepFor('2 seconds');

  // ── 3. Parallel activities ────────────────────────────────────────────
  // Promise.all works naturally. Both activities run concurrently and each
  // is independently checkpointed.
  const [dataA, dataB] = await Promise.all([
    fetchData('source-a'),
    fetchData('source-b'),
  ]);

  // ── 4. Transform (another activity) ──────────────────────────────────
  const result = await transformData({ greeting, dataA, dataB });

  // ── 5. Quick mode: skip signal wait ───────────────────────────────────
  if (mode === 'quick') {
    await notifyComplete({ status: 'auto-approved', result });
    return {
      type: 'return' as const,
      data: { greeting, result, mode, completedAt: new Date().toISOString() },
    };
  }

  // ── 6. Escalation ────────────────────────────────────────────────────
  // Return type 'escalation' to pause and wait for human input.
  // The interceptor creates an escalation record in the database.
  // When the operator resolves it, the workflow is re-run with
  // envelope.resolver containing their decision.
  if (!envelope.resolver) {
    return {
      type: 'escalation' as const,
      data: { greeting, result },
      message: `Kitchen sink workflow needs approval (name: ${name})`,
      role: 'reviewer',
    };
  }

  // ── 7. Re-entry after human resolution ────────────────────────────────
  // envelope.resolver contains the operator's payload from the dashboard.
  // No resolver_schema is defined for this workflow — any response from
  // the human (or triage) means "approved". The workflow completes.
  await notifyComplete({ status: 'approved', result });

  return {
    type: 'return' as const,
    data: {
      greeting,
      result,
      resolver: envelope.resolver,
      approved: true,
      completedAt: new Date().toISOString(),
    },
  };
}
