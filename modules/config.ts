export const config = {
  POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
  POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT || '5415', 10),
  POSTGRES_USER: process.env.POSTGRES_USER || 'postgres',
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'password',
  // In test environments, always use the test database to prevent accidental
  // pollution of the dev/prod database from test runs.
  POSTGRES_DB: process.env.NODE_ENV === 'test'
    ? 'longtail_test'
    : (process.env.POSTGRES_DB || 'longtail'),

  EVENT_TRANSPORT: process.env.EVENT_TRANSPORT || '',
  NATS_URL: process.env.NATS_URL || 'nats://localhost:4222',
  NATS_WS_URL: process.env.NATS_WS_URL || '',
  NATS_TOKEN: process.env.NATS_TOKEN || '',

  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  JWT_SECRET: process.env.JWT_SECRET || '',

  HONEYCOMB_API_KEY: process.env.HONEYCOMB_API_KEY || '',

  // Resolver schema enforcement: TTL for the cached enforcing-role set and
  // latest role form schemas. Bounds cross-container staleness after a role
  // admin flips enforce_schema or edits a schema; pinned snapshots are
  // immutable and cache indefinitely.
  ROLE_ENFORCEMENT_CACHE_TTL_MS: parseInt(process.env.ROLE_ENFORCEMENT_CACHE_TTL_MS || '30000', 10),

  // Escalation analytics (aggregateByFacets / timelineByFacet) bounds.
  // MAX_GROUPS caps the result-group page (the API signals `overflow` instead
  // of silently truncating); MAX_WINDOW_DAYS caps a dwell/timeline window so
  // one query can never sweep unbounded history. The two cache TTLs split by
  // anchor: now-anchored results tolerate pace-board-grade staleness, while a
  // fully-past window is immutable under every long-tail write path and may
  // live longer; MAX_ENTRIES LRU-bounds the past cache.
  LT_ANALYTICS_MAX_GROUPS: parseInt(process.env.LT_ANALYTICS_MAX_GROUPS || '5000', 10),
  LT_ANALYTICS_MAX_WINDOW_DAYS: parseInt(process.env.LT_ANALYTICS_MAX_WINDOW_DAYS || '35', 10),
  LT_ANALYTICS_CACHE_TTL_MS: parseInt(process.env.LT_ANALYTICS_CACHE_TTL_MS || '30000', 10),
  LT_ANALYTICS_PAST_CACHE_TTL_MS: parseInt(process.env.LT_ANALYTICS_PAST_CACHE_TTL_MS || '600000', 10),
  LT_ANALYTICS_CACHE_MAX_ENTRIES: parseInt(process.env.LT_ANALYTICS_CACHE_MAX_ENTRIES || '512', 10),
};

export const postgres_options: Record<string, unknown> = {
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DB,
};
