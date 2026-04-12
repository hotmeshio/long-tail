/**
 * Basic Echo Workflow
 *
 * Minimal durable workflow that:
 *   1. Sleeps for a configurable duration (durable timer)
 *   2. Echoes the input message back with IAM identity context
 *
 * Use this to verify:
 *   - Durable workflow invocation from the dashboard
 *   - IAM context availability (registered vs unregistered)
 *   - Cron scheduling for plain durable workers
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const { echo } = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
});

export async function basicEcho(envelope: LTEnvelope): Promise<any> {
  const { message = 'Hello, Long Tail!', sleepSeconds = 1 } = envelope.data;

  await Durable.workflow.sleep(`${sleepSeconds} seconds`);

  const echoResult = await echo({ message });

  return {
    type: 'return' as const,
    data: {
      ...echoResult,
      sleepSeconds,
      userId: envelope.lt?.userId,
    },
  };
}
