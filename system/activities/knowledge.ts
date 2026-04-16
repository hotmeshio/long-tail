import { Client as Postgres } from 'pg';

import { postgres_options } from '../../modules/config';

async function withClient<T>(fn: (client: Postgres) => Promise<T>): Promise<T> {
  const client = new Postgres(postgres_options);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function storeKnowledge(args: {
  domain: string;
  key: string;
  data: Record<string, any>;
  tags?: string[];
}): Promise<{ id: string; domain: string; key: string; created: boolean; updated_at: string }> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO lt_knowledge (domain, key, data, tags)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (domain, key) DO UPDATE SET
         data = lt_knowledge.data || EXCLUDED.data,
         tags = ARRAY(SELECT DISTINCT unnest(lt_knowledge.tags || EXCLUDED.tags))
       RETURNING id, domain, key, (xmax = 0) AS created, updated_at`,
      [args.domain, args.key, JSON.stringify(args.data), args.tags || []],
    );
    return { ...rows[0], updated_at: rows[0].updated_at.toISOString() };
  });
}

export async function getKnowledge(args: {
  domain: string;
  key: string;
}): Promise<Record<string, any>> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT id, domain, key, data, tags, created_at, updated_at
       FROM lt_knowledge WHERE domain = $1 AND key = $2`,
      [args.domain, args.key],
    );
    if (!rows.length) return { found: false, domain: args.domain, key: args.key };
    const row = rows[0];
    return {
      id: row.id,
      domain: row.domain,
      key: row.key,
      data: row.data,
      tags: row.tags,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  });
}

export async function searchKnowledge(args: {
  domain: string;
  query: Record<string, any>;
  tags?: string[];
  limit?: number;
}): Promise<{ entries: Record<string, any>[]; total: number }> {
  return withClient(async (client) => {
    const limit = Math.min(args.limit || 50, 200);
    const params: any[] = [args.domain, JSON.stringify(args.query), limit];
    let tagClause = '';
    if (args.tags?.length) {
      tagClause = ' AND tags && $4';
      params.push(args.tags);
    }

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM lt_knowledge
       WHERE domain = $1 AND data @> $2::jsonb${tagClause}`,
      tagClause ? [args.domain, JSON.stringify(args.query), ...(args.tags ? [args.tags] : [])]
        : [args.domain, JSON.stringify(args.query)],
    );

    const { rows } = await client.query(
      `SELECT id, domain, key, data, tags, created_at, updated_at
       FROM lt_knowledge
       WHERE domain = $1 AND data @> $2::jsonb${tagClause}
       ORDER BY updated_at DESC LIMIT $3`,
      params,
    );

    return {
      entries: rows.map((r) => ({
        id: r.id, domain: r.domain, key: r.key, data: r.data, tags: r.tags,
        created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(),
      })),
      total: countResult.rows[0].total,
    };
  });
}

export async function listKnowledge(args: {
  domain: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}): Promise<{ entries: Record<string, any>[]; total: number }> {
  return withClient(async (client) => {
    const limit = Math.min(args.limit || 50, 200);
    const offset = args.offset || 0;
    const params: any[] = [args.domain];
    let tagClause = '';
    if (args.tags?.length) {
      tagClause = ' AND tags && $2';
      params.push(args.tags);
    }

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM lt_knowledge WHERE domain = $1${tagClause}`,
      params,
    );

    const queryParams = [...params, limit, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const { rows } = await client.query(
      `SELECT id, domain, key, data, tags, created_at, updated_at
       FROM lt_knowledge WHERE domain = $1${tagClause}
       ORDER BY updated_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams,
    );

    return {
      entries: rows.map((r) => ({
        id: r.id, domain: r.domain, key: r.key, data: r.data, tags: r.tags,
        created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(),
      })),
      total: countResult.rows[0].total,
    };
  });
}

export async function deleteKnowledge(args: {
  domain: string;
  key: string;
}): Promise<{ deleted: boolean }> {
  return withClient(async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM lt_knowledge WHERE domain = $1 AND key = $2`,
      [args.domain, args.key],
    );
    return { deleted: (rowCount ?? 0) > 0 };
  });
}

export async function listDomains(): Promise<{
  domains: Array<{ domain: string; count: number; latest: string }>;
}> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT domain, COUNT(*)::int AS count, MAX(updated_at) AS latest
       FROM lt_knowledge GROUP BY domain ORDER BY latest DESC`,
    );
    return {
      domains: rows.map((r) => ({
        domain: r.domain,
        count: r.count,
        latest: r.latest.toISOString(),
      })),
    };
  });
}

export async function appendKnowledge(args: {
  domain: string;
  key: string;
  path: string;
  value: any;
}): Promise<{ id: string; domain: string; key: string; updated_at: string }> {
  return withClient(async (client) => {
    const pathParts = args.path.split('.');
    const pathArray = pathParts;
    const valueJson = JSON.stringify(args.value);

    // Build the initial data object for INSERT (nested path support)
    let initData: Record<string, any> = { [pathParts[pathParts.length - 1]]: [args.value] };
    for (let i = pathParts.length - 2; i >= 0; i--) {
      initData = { [pathParts[i]]: initData };
    }

    const { rows } = await client.query(
      `INSERT INTO lt_knowledge (domain, key, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (domain, key) DO UPDATE SET
         data = CASE
           WHEN lt_knowledge.data #> $4::text[] IS NULL
           THEN jsonb_set(lt_knowledge.data, $4::text[], jsonb_build_array($5::jsonb))
           ELSE jsonb_set(lt_knowledge.data, $4::text[], (lt_knowledge.data #> $4::text[]) || jsonb_build_array($5::jsonb))
         END
       RETURNING id, domain, key, updated_at`,
      [args.domain, args.key, JSON.stringify(initData), pathArray, valueJson],
    );
    return { ...rows[0], updated_at: rows[0].updated_at.toISOString() };
  });
}
