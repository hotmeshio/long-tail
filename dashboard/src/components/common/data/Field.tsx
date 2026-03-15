import type { ReactNode } from 'react';
import { SectionLabel } from '../layout/SectionLabel';

interface FieldProps {
  label: string;
  value: ReactNode;
}

export function Field({ label, value }: FieldProps) {
  return (
    <div>
      <SectionLabel className="mb-1">{label}</SectionLabel>
      <div className="text-sm text-text-primary">{value ?? '—'}</div>
    </div>
  );
}
