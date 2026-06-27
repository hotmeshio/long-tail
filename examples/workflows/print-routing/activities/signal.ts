/**
 * Signal an order's wake key — used to wake a parked `printOrder` once its insoles
 * have printed. A thin wrapper over the durable client's signal.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../../../lib/db';

export async function signalOrder(input: {
  taskQueue: string;
  workflowType: string;
  workflowId: string;
  signalId: string;
  data: Record<string, any>;
}): Promise<void> {
  const client = new Durable.Client({ connection: getConnection() });
  const handle = await client.workflow.getHandle(
    input.taskQueue,
    input.workflowType,
    input.workflowId,
  );
  await handle.signal(input.signalId, input.data);
}
