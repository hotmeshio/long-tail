import { Client as Postgres } from 'pg';
import { MemFlow } from '@hotmeshio/hotmesh';

const { Connection } = MemFlow;

export const postgres_options = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'longtail',
};

export async function connectPostgres() {
  return Connection.connect({
    class: Postgres,
    options: postgres_options,
  });
}

export async function dropTables(client: any): Promise<void> {
  await client.query('DROP TABLE IF EXISTS lt_escalations CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_tasks CASCADE');
  await client.query('DROP TABLE IF EXISTS lt_migrations CASCADE');
}

export async function truncateTables(client: any): Promise<void> {
  await client.query('TRUNCATE lt_escalations CASCADE');
  await client.query('TRUNCATE lt_tasks CASCADE');
}

export function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
