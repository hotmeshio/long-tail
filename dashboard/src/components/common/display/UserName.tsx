import { useUser } from '../../../api/users';

/**
 * Resolves a user ID to their display name (or email, or truncated ID as fallback).
 * Renders inline — suitable for use inside <span>, <p>, etc.
 */
export function UserName({ userId, fallback }: { userId: string; fallback?: string }) {
  const { data: resolved } = useUser(userId);

  if (resolved) {
    return <>{resolved.display_name || resolved.email || resolved.external_id}</>;
  }

  // Still loading or no record — show fallback or truncated ID
  return <>{fallback ?? `${userId.slice(0, 8)}…`}</>;
}
