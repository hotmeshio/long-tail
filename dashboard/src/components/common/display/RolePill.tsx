import { User } from 'lucide-react';

interface RolePillProps {
  role: string;
  size?: 'sm' | 'md';
  /** `default` uses secondary text; `inherit` takes the surrounding text colour. */
  tone?: 'default' | 'inherit';
}

export function RolePill({ role, size = 'sm', tone = 'default' }: RolePillProps) {
  const sizeClass = size === 'md'
    ? 'py-0.5 text-xs gap-1.5'
    : 'py-0.5 text-[10px] gap-1';
  const iconClass = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';
  const colorClass = tone === 'inherit' ? 'text-inherit' : 'text-text-secondary';

  return (
    <span className={`inline-flex items-center whitespace-nowrap ${sizeClass} ${colorClass}`}>
      <User className={`${iconClass} shrink-0 text-accent/75`} />
      {role}
    </span>
  );
}
