import { useState } from 'react';
import { Trash2, Clock, Info } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { PruneSection } from './PruneSection';
import { ScheduleSection } from './ScheduleSection';

type Mode = 'prune' | 'schedule';

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
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
      {btn('prune', <Trash2 className="w-3.5 h-3.5" />, 'Prune Now')}
      {btn('schedule', <Clock className="w-3.5 h-3.5" />, 'Schedule')}
    </div>
  );
}

export function MaintenancePage() {
  const [mode, setMode] = useState<Mode>('schedule');

  return (
    <div>
      <PageHeader
        title="DB Maintenance"
        docsHash="#docs:dashboard.md:db-maintenance"
        actions={<ModeToggle mode={mode} onChange={setMode} />}
      />

      <div className="flex items-start gap-2 px-4 py-3 mb-8 rounded-md bg-accent/5 border border-accent/10">
        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-text-secondary leading-relaxed">
          Workflow data grows as jobs complete. Operations are ordered safest-first: stream messages are
          always safe to prune, workflow reduction preserves results, and deletion is permanent.
        </p>
      </div>

      {mode === 'prune' ? <PruneSection /> : <ScheduleSection />}
    </div>
  );
}
