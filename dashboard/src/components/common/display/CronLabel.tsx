import { Clock } from 'lucide-react';

interface CronLabelProps {
  cron: string;
}

/**
 * Universal cron expression display — Clock icon + monotype text.
 * Used everywhere a cron schedule is rendered.
 */
export function CronLabel({ cron }: CronLabelProps) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-text-secondary">
      <Clock className="w-2.5 h-2.5 shrink-0 text-text-quaternary" strokeWidth={1.5} />
      {cron}
    </span>
  );
}
