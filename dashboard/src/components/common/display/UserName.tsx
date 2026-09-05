import { useUserName } from '../../../api/users';

/**
 * Resolves a user ID to their display name (or email, or truncated ID as
 * fallback) through the batched, session-cached name path. Renders inline by
 * default; pass a className to render a span that can truncate, carrying the
 * full name in its title for hover reveal.
 */
export function UserName({ userId, fallback, className }: { userId: string; fallback?: string; className?: string }) {
  const { data } = useUserName(userId);
  const name = data
    ? (data.display_name || data.email || data.external_id)
    : (fallback ?? `${userId.slice(0, 8)}…`);

  if (className) return <span className={className} title={name}>{name}</span>;
  return <>{name}</>;
}
