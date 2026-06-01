import { config, postgres_options } from '../modules/config';
import { setAuthAdapter } from '../modules/auth';
import { loggerRegistry } from '../lib/logger';

import type { LTStartConfig } from '../types/startup';

/**
 * Apply database connection settings from the startup config
 * to the shared postgres_options object.
 */
export function applyDatabaseConfig(db: LTStartConfig['database']): void {
  if (db.connectionString) {
    // Infer SSL from sslmode in connection string when not explicitly provided
    if (!db.ssl) {
      try {
        const sslmode = new URL(db.connectionString).searchParams.get('sslmode');
        if (sslmode === 'require') {
          postgres_options.ssl = { rejectUnauthorized: false };
          loggerRegistry.info('[long-tail] database SSL inferred from sslmode=require');
        }
      } catch { /* not a parseable URL — skip inference */ }
    }

    // Clear individual fields — connectionString takes precedence.
    // Delete stale keys so pg doesn't see conflicting host/port/etc.
    delete postgres_options.host;
    delete postgres_options.port;
    delete postgres_options.user;
    delete postgres_options.password;
    delete postgres_options.database;
    postgres_options.connectionString = db.connectionString;
  } else {
    postgres_options.host = db.host ?? postgres_options.host;
    postgres_options.port = db.port ?? postgres_options.port;
    postgres_options.user = db.user ?? postgres_options.user;
    postgres_options.password = db.password ?? postgres_options.password;
    postgres_options.database = db.database ?? postgres_options.database;
  }

  // SSL passthrough — applies to both connectionString and individual-field modes
  if (db.ssl !== undefined) {
    postgres_options.ssl = db.ssl;
    loggerRegistry.info(`[long-tail] database SSL configured: ${typeof db.ssl === 'object' ? JSON.stringify(db.ssl) : db.ssl}`);
  }
}

/**
 * Apply server port and auth settings from the startup config.
 */
export async function applyServerAuthConfig(startConfig: LTStartConfig): Promise<void> {
  const serverPort = startConfig.server?.port ?? config.PORT;
  config.PORT = serverPort;

  if (startConfig.auth?.secret) {
    config.JWT_SECRET = startConfig.auth.secret;
  }
  if (startConfig.auth?.adapter) {
    setAuthAdapter(startConfig.auth.adapter);
  }

  // Initialize OAuth providers (from startup config and/or env vars)
  const { initializeOAuth } = await import('../services/oauth');
  initializeOAuth(startConfig.auth?.oauth);

  if (startConfig.auth?.oauth) {
    const { setOAuthConfig } = await import('../routes/oauth');
    setOAuthConfig({
      autoProvision: startConfig.auth.oauth.autoProvision,
      defaultRoleType: startConfig.auth.oauth.defaultRoleType,
      baseUrl: startConfig.auth.oauth.baseUrl,
    });
  }

}
