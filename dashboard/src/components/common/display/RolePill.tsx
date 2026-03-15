import { User } from 'lucide-react';

interface RolePillProps {
  role: string;
  size?: 'sm' | 'md';
}

export function RolePill({ role, size = 'sm' }: RolePillProps) {
  const sizeClass = size === 'md'
    ? 'px-2.5 py-0.5 text-[11px] gap-1.5'
    : 'px-2 py-0.5 text-[10px] gap-1';
  const iconClass = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  return (
    <span className={`inline-flex items-center ${sizeClass} bg-surface-sunken rounded-full text-text-secondary`}>
      <User className={`${iconClass} shrink-0`} />
      {role}
    </span>
  );
}
