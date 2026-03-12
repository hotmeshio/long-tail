import { Durable } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';

import { postgres_options } from '../../modules/config';

export function createClient() {
  return new Durable.Client({
    connection: { class: Postgres, options: postgres_options },
  });
}

export async function getHandle(
  taskQueue: string,
  workflowName: string,
  workflowId: string,
) {
  const client = createClient();
  return client.workflow.getHandle(taskQueue, workflowName, workflowId);
}
