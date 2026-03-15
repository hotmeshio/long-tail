import type { ReactNode } from 'react';

interface PillProps {
  children: ReactNode;
  className?: string;
}

export function Pill({ children, className = '' }: PillProps) {
  return (
    <span className={`px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full text-text-secondary ${className}`}>
      {children}
    </span>
  );
}
