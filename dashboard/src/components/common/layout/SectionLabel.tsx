import type { ReactNode } from 'react';

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
}

export function SectionLabel({ children, className = '' }: SectionLabelProps) {
  return (
    <p className={`text-2xs font-semibold uppercase tracking-widest text-text-tertiary ${className}`}>
      {children}
    </p>
  );
}
