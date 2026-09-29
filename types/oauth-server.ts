import type { LTReadScope, LTWriteScope, LTRoleType } from './user';

/**
 * The rights a person granted a client at consent. `read_only` is reads and
 * read-safe invokes wherever the person can read; `just_me` is exactly the
 * person's rights.
 */
export type LTGrantPreset = 'read_only' | 'just_me';

export interface LTGrantPolicy {
  preset: LTGrantPreset;
}

/** One of the person's role memberships, as of issue or refresh. */
export interface LTGrantRole {
  role: string;
  type: LTRoleType;
  read_scope: LTReadScope;
  write_scope: LTWriteScope;
}

export interface LTOAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  created_at: Date;
}

/** What a code exchange or refresh returns: the grant and the person's live roles. */
export interface LTGrantSnapshot {
  grant_id: string;
  user_id: string;
  client_id: string;
  policy: LTGrantPolicy;
  scope: string;
  roles: LTGrantRole[];
}

/** The OAuth authorization server for `/mcp`. Absent: `/mcp` accepts only today's credentials. */
export interface LTOAuthServerConfig {
  /** Public base URL Long Tail is served under, e.g. `https://api.example.com/longtail`. */
  issuer: string;
  /** Hosts allowed in non-loopback redirect URIs at client registration. */
  allowedRedirectHosts?: string[];
}
