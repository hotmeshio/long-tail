import { Play, Clock } from 'lucide-react';

export type Mode = 'now' | 'schedule';

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const btn = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => onChange(m)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
        mode === m
          ? 'bg-accent/10 text-accent font-medium'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex gap-1 p-0.5 bg-surface-sunken rounded-lg w-fit">
      {btn('now', <Play className="w-3.5 h-3.5" />, 'Start Now')}
      {btn('schedule', <Clock className="w-3.5 h-3.5" />, 'Schedule')}
    </div>
  );
}
