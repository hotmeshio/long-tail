import { Inbox } from 'lucide-react';

interface RolePillProps {
  role: string;
  size?: 'sm' | 'md';
  /** `default` uses secondary text; `inherit` takes the surrounding text colour. */
  tone?: 'default' | 'inherit';
}

/**
 * The universal role symbol. A role is a QUEUE — a tray work arrives into and
 * is claimed from — so the inbox glyph carries it everywhere a role appears:
 * this pill, the admin sidebar's Roles entry, and the role detail page.
 */
export function RolePill({ role, size = 'sm', tone = 'default' }: RolePillProps) {
  const sizeClass = size === 'md'
    ? 'py-0.5 text-xs gap-1.5'
    : 'py-0.5 text-2xs gap-1';
  const iconClass = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';
  const colorClass = tone === 'inherit' ? 'text-inherit' : 'text-text-secondary';

  return (
    <span className={`inline-flex items-center max-w-full min-w-0 ${sizeClass} ${colorClass}`} title={role}>
      <Inbox className={`${iconClass} shrink-0 text-accent/75`} />
      <span className="truncate">{role}</span>
    </span>
  );
}
