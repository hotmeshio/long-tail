import { ClipboardIcon, SparkleIcon, BellIcon, UserIcon } from './SwimlaneIcons';

interface SwimlaneHeaderProps {
  allExpanded: boolean;
  onToggleAll: () => void;
}

export function SwimlaneHeader({ allExpanded, onToggleAll }: SwimlaneHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-4 flex-wrap">
      <button onClick={onToggleAll} className="text-[10px] text-accent hover:underline">
        {allExpanded ? 'Collapse all' : 'Expand all'}
      </button>

      {/* Legend */}
      <div className="flex items-center gap-4 ml-auto">
        <div className="flex items-center gap-1">
          <ClipboardIcon className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-[9px] text-text-tertiary">Task</span>
        </div>
        <div className="flex items-center gap-1">
          <SparkleIcon className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-[9px] text-text-tertiary">AI Task</span>
        </div>
        <div className="flex items-center gap-1">
          <UserIcon className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-[9px] text-text-tertiary">Escalation</span>
        </div>
        <div className="flex items-center gap-1">
          <BellIcon className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-[9px] text-text-tertiary">Notification</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-status-success" />
          <span className="text-[9px] text-text-tertiary">Done</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-status-warning" />
          <span className="text-[9px] text-text-tertiary">Active</span>
        </div>
      </div>
    </div>
  );
}
