import { SectionLabel } from '../layout/SectionLabel';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  dotClass?: string;
}

export function StatCard({ label, value, sub, dotClass }: StatCardProps) {
  return (
    <div className="py-6">
      <div className="flex items-center gap-2 mb-2">
        {dotClass && <span className={`w-2 h-2 rounded-full ${dotClass}`} />}
        <SectionLabel>{label}</SectionLabel>
      </div>
      <p className="text-3xl font-light text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-tertiary mt-1.5">{sub}</p>}
    </div>
  );
}
