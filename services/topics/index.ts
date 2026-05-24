import { getPool } from '../../lib/db';
import {
  LIST_TOPICS,
  COUNT_TOPICS,
  GET_TOPIC,
  INSERT_TOPIC,
  UPDATE_TOPIC,
  DELETE_TOPIC,
  UPSERT_ON_PUBLISH,
  SEED_TOPIC,
  RESET_TOPIC,
  LIST_SUBSCRIBERS,
} from './sql';

export interface TopicCatalogEntry {
  topic: string;
  description?: string;
  category: string;
  payload_schema?: Record<string, any>;
  example_payload?: Record<string, any>;
  source: string;
  tags: string[];
  /** When true, this topic is managed by static config (reset: true). Dashboard edits would be overwritten on next boot. */
  managed: boolean;
  last_seen_at?: string;
  subscriber_count?: number;
  created_at: string;
  updated_at: string;
}

export interface TopicSubscriber {
  id: string;
  agent_id: string;
  agent_name: string;
  topic: string;
  reaction_type: string;
}

export async function listTopics(filters: {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ topics: TopicCatalogEntry[]; total: number }> {
  const pool = getPool();
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const category = filters.category ?? null;
  const search = filters.search ?? null;

  const [dataResult, countResult] = await Promise.all([
    pool.query(LIST_TOPICS, [category, search, limit, offset]),
    pool.query(COUNT_TOPICS, [category, search]),
  ]);

  return {
    topics: dataResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function getTopic(topic: string): Promise<(TopicCatalogEntry & { subscribers: TopicSubscriber[] }) | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_TOPIC, [topic]);
  if (!rows[0]) return null;

  const { rows: subscribers } = await pool.query(LIST_SUBSCRIBERS, [topic]);

  return { ...rows[0], subscribers };
}

export async function createTopic(data: {
  topic: string;
  description?: string;
  category: string;
  payload_schema?: Record<string, any>;
  example_payload?: Record<string, any>;
  source?: string;
  tags?: string[];
}): Promise<TopicCatalogEntry> {
  const pool = getPool();
  const { rows } = await pool.query(INSERT_TOPIC, [
    data.topic,
    data.description ?? null,
    data.category,
    data.payload_schema ? JSON.stringify(data.payload_schema) : null,
    data.example_payload ? JSON.stringify(data.example_payload) : null,
    data.source ?? 'app',
    data.tags ?? [],
  ]);
  return rows[0];
}

export async function updateTopic(
  topic: string,
  data: Partial<TopicCatalogEntry>,
): Promise<TopicCatalogEntry | null> {
  const pool = getPool();
  const { rows } = await pool.query(UPDATE_TOPIC, [
    topic,
    data.description ?? null,
    data.category ?? null,
    data.payload_schema ? JSON.stringify(data.payload_schema) : null,
    data.example_payload ? JSON.stringify(data.example_payload) : null,
    data.tags ?? null,
  ]);
  return rows[0] ?? null;
}

export async function deleteTopic(topic: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_TOPIC, [topic]);
  return (rowCount ?? 0) > 0;
}

/**
 * Auto-register or update a topic on publish (learn-on-first-use).
 * Creates the entry on first publish; updates last_seen on subsequent publishes.
 */
export async function upsertTopicOnPublish(
  topic: string,
  data?: Record<string, any>,
  source?: string,
): Promise<void> {
  const pool = getPool();
  const category = topic.startsWith('app.') ? 'app' : topic.split('.')[0];
  await pool.query(UPSERT_ON_PUBLISH, [
    topic,
    category,
    source ?? 'mcp-tool',
    data ? JSON.stringify(data) : null,
  ]);
}

/**
 * Seed a topic at startup (insert-if-absent).
 * Conflict on topic — DB is source of truth after first boot.
 */
export async function seedTopic(data: {
  topic: string;
  description: string;
  category: string;
  payload_schema?: Record<string, any>;
  example_payload?: Record<string, any>;
  source?: string;
  tags?: string[];
}): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(SEED_TOPIC, [
    data.topic,
    data.description,
    data.category,
    data.payload_schema ? JSON.stringify(data.payload_schema) : null,
    data.example_payload ? JSON.stringify(data.example_payload) : null,
    data.source ?? 'system',
    data.tags ?? [],
  ]);
  return (rowCount ?? 0) > 0;
}

/**
 * Reset a topic at startup — config is source of truth.
 * Overwrites description, category, schema, tags on every boot.
 * Used when `reset: true` is set in static topic config.
 */
export async function resetTopic(data: {
  topic: string;
  description: string;
  category: string;
  payload_schema?: Record<string, any>;
  example_payload?: Record<string, any>;
  source?: string;
  tags?: string[];
}): Promise<void> {
  const pool = getPool();
  await pool.query(RESET_TOPIC, [
    data.topic,
    data.description,
    data.category,
    data.payload_schema ? JSON.stringify(data.payload_schema) : null,
    data.example_payload ? JSON.stringify(data.example_payload) : null,
    data.source ?? 'config',
    data.tags ?? [],
  ]);
}
