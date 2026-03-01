export const config = {
  POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
  POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  POSTGRES_USER: process.env.POSTGRES_USER || 'postgres',
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'password',
  // In test environments, always use the test database to prevent accidental
  // pollution of the dev/prod database from test runs.
  POSTGRES_DB: process.env.NODE_ENV === 'test'
    ? 'longtail_test'
    : (process.env.POSTGRES_DB || 'longtail'),

  NATS_URL: process.env.NATS_URL || 'nats://localhost:4222',

  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  JWT_SECRET: process.env.JWT_SECRET || '',

  HONEYCOMB_API_KEY: process.env.HONEYCOMB_API_KEY || '',
};

export const postgres_options = {
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DB,
};
