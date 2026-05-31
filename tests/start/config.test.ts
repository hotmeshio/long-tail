import { describe, it, expect, beforeEach } from 'vitest';

import { postgres_options } from '../../modules/config';
import { applyDatabaseConfig } from '../../start/config';

// Snapshot original values so each test starts clean
const ORIGINAL = { ...postgres_options };

beforeEach(() => {
  // Reset postgres_options to defaults before each test
  for (const key of Object.keys(postgres_options)) {
    delete postgres_options[key];
  }
  Object.assign(postgres_options, { ...ORIGINAL });
});

describe('applyDatabaseConfig', () => {
  it('applies individual fields and preserves defaults for omitted fields', () => {
    applyDatabaseConfig({ host: 'db.example.com', port: 5432 });
    expect(postgres_options.host).toBe('db.example.com');
    expect(postgres_options.port).toBe(5432);
    expect(postgres_options.user).toBe(ORIGINAL.user);
    expect(postgres_options.password).toBe(ORIGINAL.password);
  });

  it('applies connectionString and clears individual fields', () => {
    applyDatabaseConfig({ connectionString: 'postgres://u:p@host/db' });
    expect(postgres_options.connectionString).toBe('postgres://u:p@host/db');
    expect(postgres_options.host).toBeUndefined();
    expect(postgres_options.port).toBeUndefined();
  });

  it('passes ssl: true through to postgres_options', () => {
    applyDatabaseConfig({ host: 'db.example.com', ssl: true });
    expect(postgres_options.ssl).toBe(true);
    expect(postgres_options.host).toBe('db.example.com');
  });

  it('passes ssl: false through to postgres_options', () => {
    applyDatabaseConfig({ host: 'db.example.com', ssl: false });
    expect(postgres_options.ssl).toBe(false);
  });

  it('passes ssl object (rejectUnauthorized: false) for VPC connections', () => {
    const sslConfig = { rejectUnauthorized: false };
    applyDatabaseConfig({ host: 'vpc-db.internal', ssl: sslConfig });
    expect(postgres_options.ssl).toEqual({ rejectUnauthorized: false });
    expect(postgres_options.host).toBe('vpc-db.internal');
  });

  it('passes ssl with connectionString mode', () => {
    applyDatabaseConfig({
      connectionString: 'postgres://u:p@vpc-host/db',
      ssl: { rejectUnauthorized: false },
    });
    expect(postgres_options.connectionString).toBe('postgres://u:p@vpc-host/db');
    expect(postgres_options.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('does not set ssl when omitted from config', () => {
    applyDatabaseConfig({ host: 'db.example.com' });
    expect(postgres_options.ssl).toBeUndefined();
  });

  it('preserves ssl across successive calls', () => {
    applyDatabaseConfig({ host: 'host1', ssl: { rejectUnauthorized: false } });
    expect(postgres_options.ssl).toEqual({ rejectUnauthorized: false });

    // Second call without ssl should NOT clear the previous value
    applyDatabaseConfig({ host: 'host2' });
    expect(postgres_options.host).toBe('host2');
    expect(postgres_options.ssl).toEqual({ rejectUnauthorized: false });
  });
});
