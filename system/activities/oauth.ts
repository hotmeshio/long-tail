import {
  getFreshAccessToken,
  listOAuthConnections,
  deleteOAuthConnection,
} from '../../services/oauth';

/**
 * Get a fresh OAuth access token for an external service.
 * Automatically refreshes expired tokens.
 */
export async function getAccessToken(args: {
  provider: string;
  user_id: string;
  label?: string;
}): Promise<{
  access_token: string;
  expires_at: string | null;
  scopes: string[];
  label: string;
}> {
  const token = await getFreshAccessToken(args.user_id, args.provider, args.label);
  return {
    access_token: token.accessToken,
    expires_at: token.expiresAt?.toISOString() ?? null,
    scopes: token.scopes,
    label: token.label,
  };
}

/**
 * List a user's connected OAuth providers.
 */
export async function listConnections(args: {
  user_id: string;
}): Promise<{
  connections: Array<{
    provider: string;
    label: string;
    email: string | null;
    scopes: string[];
    expires_at: string | null;
    credential_type: string | null;
  }>;
}> {
  const connections = await listOAuthConnections(args.user_id);
  return { connections };
}

/**
 * Revoke an OAuth connection for a user.
 */
export async function revokeConnection(args: {
  provider: string;
  user_id: string;
  label?: string;
}): Promise<{ success: boolean }> {
  const deleted = await deleteOAuthConnection(args.user_id, args.provider, args.label);
  return { success: deleted };
}
