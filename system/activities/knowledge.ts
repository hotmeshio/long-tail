import { Client } from 'pg';

import { getConnection } from '../../lib/db';
import {
  UPSERT_KNOWLEDGE,
  REPLACE_KNOWLEDGE,
  GET_KNOWLEDGE,
  SEARCH_KNOWLEDGE,
  COUNT_KNOWLEDGE_SEARCH,
  LIST_KNOWLEDGE,
  COUNT_KNOWLEDGE_LIST,
  DELETE_KNOWLEDGE,
  LIST_DOMAINS,
  SET_KNOWLEDGE_FIELD,
  REMOVE_KNOWLEDGE_FIELD,
  APPEND_KNOWLEDGE,
} from './sql';

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const { class: PgClient, options } = getConnection();
  const client = new PgClient(options);
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
  replace?: boolean;
}): Promise<{ id: string; domain: string; key: string; created: boolean; updated_at: string }> {
  return withClient(async (client) => {
    const sql = args.replace ? REPLACE_KNOWLEDGE : UPSERT_KNOWLEDGE;
    const { rows } = await client.query(
      sql,
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
    const { rows } = await client.query(GET_KNOWLEDGE, [args.domain, args.key]);
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
  offset?: number;
}): Promise<{ entries: Record<string, any>[]; total: number }> {
  return withClient(async (client) => {
    const limit = Math.min(args.limit || 50, 200);
    const offset = args.offset || 0;
    const params: any[] = [args.domain, JSON.stringify(args.query)];
    let tagClause = '';
    if (args.tags?.length) {
      params.push(args.tags);
      tagClause = ` AND tags && $${params.length}`;
    }

    const countParams = [...params];
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM lt_knowledge
       WHERE domain = $1 AND data @> $2::jsonb${tagClause}`,
      countParams,
    );

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await client.query(
      `SELECT id, domain, key, data, tags, created_at, updated_at
       FROM lt_knowledge
       WHERE domain = $1 AND data @> $2::jsonb${tagClause}
       ORDER BY updated_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
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
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: Record<string, any>[]; total: number }> {
  return withClient(async (client) => {
    const limit = Math.min(args.limit || 50, 200);
    const offset = args.offset || 0;
    const params: any[] = [args.domain];
    let extraClauses = '';

    if (args.tags?.length) {
      params.push(args.tags);
      extraClauses += ` AND tags && $${params.length}`;
    }

    if (args.search) {
      params.push(`%${args.search}%`);
      const searchIdx = params.length;
      // Match key by ILIKE or any tag element by ILIKE
      extraClauses += ` AND (key ILIKE $${searchIdx} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $${searchIdx}))`;
    }

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM lt_knowledge WHERE domain = $1${extraClauses}`,
      params,
    );

    const queryParams = [...params, limit, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const { rows } = await client.query(
      `SELECT id, domain, key, data, tags, created_at, updated_at
       FROM lt_knowledge WHERE domain = $1${extraClauses}
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
    const { rowCount } = await client.query(DELETE_KNOWLEDGE, [args.domain, args.key]);
    return { deleted: (rowCount ?? 0) > 0 };
  });
}

export async function setKnowledgeField(args: {
  domain: string;
  key: string;
  path: string;
  value: any;
  tags?: string[];
}): Promise<{ id: string; domain: string; key: string; created: boolean; updated_at: string }> {
  return withClient(async (client) => {
    const pathParts = args.path.split('.');
    // Build initial data for INSERT (nested structure from path)
    let initData: Record<string, any> = { [pathParts[pathParts.length - 1]]: args.value };
    for (let i = pathParts.length - 2; i >= 0; i--) {
      initData = { [pathParts[i]]: initData };
    }
    const { rows } = await client.query(
      SET_KNOWLEDGE_FIELD,
      [
        args.domain,
        args.key,
        JSON.stringify(initData),
        args.tags || [],
        pathParts,
        JSON.stringify(args.value),
      ],
    );
    return { ...rows[0], updated_at: rows[0].updated_at.toISOString() };
  });
}

export async function removeKnowledgeField(args: {
  domain: string;
  key: string;
  path: string;
}): Promise<{ removed: boolean }> {
  return withClient(async (client) => {
    const pathParts = args.path.split('.');
    const { rowCount } = await client.query(
      REMOVE_KNOWLEDGE_FIELD,
      [args.domain, args.key, pathParts],
    );
    return { removed: (rowCount ?? 0) > 0 };
  });
}

export async function listDomains(): Promise<{
  domains: Array<{ domain: string; count: number; latest: string }>;
}> {
  return withClient(async (client) => {
    const { rows } = await client.query(LIST_DOMAINS);
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
      APPEND_KNOWLEDGE,
      [args.domain, args.key, JSON.stringify(initData), pathArray, valueJson],
    );
    return { ...rows[0], updated_at: rows[0].updated_at.toISOString() };
  });
}
