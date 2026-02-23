import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../modules/config';
import { telemetryRegistry } from '../services/telemetry';
import { eventRegistry } from '../services/events';
import { createLTInterceptor } from '../interceptor';
import { createLTActivityInterceptor } from '../interceptor/activity-interceptor';
import * as interceptorActivities from '../interceptor/activities';
import * as reviewContentWorkflow from '../workflows/review-content';
import * as verifyDocumentWorkflow from '../workflows/verify-document';
import * as reviewContentOrchWorkflow from '../workflows/review-content/orchestrator';
import * as verifyDocumentOrchWorkflow from '../workflows/verify-document/orchestrator';

// Leaf workflow queues
const LT_TASK_QUEUE = 'long-tail';
const LT_VERIFY_QUEUE = 'long-tail-verify';

// Orchestrator queues
const LT_REVIEW_ORCH_QUEUE = 'lt-review-orch';
const LT_VERIFY_ORCH_QUEUE = 'lt-verify-orch';

// Shared interceptor activity queue
const LT_ACTIVITY_QUEUE = 'lt-interceptor';

/**
 * Register the shared interceptor activity worker, register the LT
 * interceptor, and start workflow workers (leaf + orchestrators).
 */
export async function startWorkers(): Promise<void> {
  // 0. Connect telemetry BEFORE HotMesh starts (OTEL TracerProvider must
  //    be registered before HotMesh creates tracers)
  if (telemetryRegistry.hasAdapter) {
    await telemetryRegistry.connect();
  }

  const connection = {
    class: Postgres,
    options: postgres_options,
  };

  // 1. Register shared activity worker for interceptor DB operations
  await Durable.registerActivityWorker(
    { connection, taskQueue: LT_ACTIVITY_QUEUE },
    interceptorActivities,
    LT_ACTIVITY_QUEUE,
  );

  // 2. Register the LT interceptor
  const ltInterceptor = createLTInterceptor({
    activityTaskQueue: LT_ACTIVITY_QUEUE,
    defaultRole: 'reviewer',
    defaultModality: 'default',
  });
  Durable.registerInterceptor(ltInterceptor);

  // 2b. Register the LT activity interceptor (pass-through for now)
  const ltActivityInterceptor = createLTActivityInterceptor();
  Durable.registerActivityInterceptor(ltActivityInterceptor);

  // 3. Start leaf workflow workers
  const reviewWorker = await Durable.Worker.create({
    connection,
    taskQueue: LT_TASK_QUEUE,
    workflow: reviewContentWorkflow.reviewContent,
  });
  await reviewWorker.run();

  const verifyWorker = await Durable.Worker.create({
    connection,
    taskQueue: LT_VERIFY_QUEUE,
    workflow: verifyDocumentWorkflow.verifyDocument,
  });
  await verifyWorker.run();

  // 4. Start orchestrator workflow workers
  const reviewOrchWorker = await Durable.Worker.create({
    connection,
    taskQueue: LT_REVIEW_ORCH_QUEUE,
    workflow: reviewContentOrchWorkflow.reviewContentOrchestrator,
  });
  await reviewOrchWorker.run();

  const verifyOrchWorker = await Durable.Worker.create({
    connection,
    taskQueue: LT_VERIFY_ORCH_QUEUE,
    workflow: verifyDocumentOrchWorkflow.verifyDocumentOrchestrator,
  });
  await verifyOrchWorker.run();

  // Connect event adapters (no-op if none registered)
  if (eventRegistry.hasAdapters) {
    await eventRegistry.connect();
    console.log('[workers] event adapters connected');
  }

  console.log(
    `[workers] started on queues: ${LT_TASK_QUEUE}, ${LT_VERIFY_QUEUE}, ` +
    `${LT_REVIEW_ORCH_QUEUE}, ${LT_VERIFY_ORCH_QUEUE}`,
  );
}

/**
 * Create a Durable client for starting workflows and sending signals.
 */
export function createClient() {
  return new Durable.Client({
    connection: {
      class: Postgres,
      options: postgres_options,
    },
  });
}

export {
  LT_TASK_QUEUE,
  LT_VERIFY_QUEUE,
  LT_REVIEW_ORCH_QUEUE,
  LT_VERIFY_ORCH_QUEUE,
  LT_ACTIVITY_QUEUE,
};
