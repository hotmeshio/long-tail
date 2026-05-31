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
    Object.assign(postgres_options, {
      connectionString: db.connectionString,
      host: undefined,
      port: undefined,
      user: undefined,
      password: undefined,
      database: undefined,
    });
  } else {
    Object.assign(postgres_options, {
      host: db.host ?? postgres_options.host,
      port: db.port ?? postgres_options.port,
      user: db.user ?? postgres_options.user,
      password: db.password ?? postgres_options.password,
      database: db.database ?? postgres_options.database,
    });
  }

  // SSL passthrough — applies to both connectionString and individual-field modes
  if (db.ssl !== undefined) {
    postgres_options.ssl = db.ssl;
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
