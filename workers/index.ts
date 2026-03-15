import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../modules/config';

/** Default task queue for leaf workflows. */
export const LT_TASK_QUEUE = 'long-tail-examples';

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
