import { Bot, UserCircle } from 'lucide-react';
import { BotPicker } from './BotPicker';
import { useAuth } from '../../../hooks/useAuth';

interface RunAsSelectorProps {
  selected: string;
  onChange: (botExternalId: string) => void;
}

export function RunAsSelector({ selected, onChange }: RunAsSelectorProps) {
  const { user, isSuperAdmin, hasRoleType } = useAuth();
  const isAdmin = isSuperAdmin || hasRoleType('admin');

  if (!isAdmin) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent/[0.06] border border-accent/20">
        {selected ? (
          <>
            <Bot className="w-3 h-3 text-accent/75 shrink-0" strokeWidth={1.5} />
            <span className="text-[10px] text-text-secondary">
              Running as <span className="font-medium text-accent font-mono">{selected}</span>
            </span>
          </>
        ) : (
          <>
            <UserCircle className="w-3 h-3 text-accent/75 shrink-0" strokeWidth={1.5} />
            <span className="text-[10px] text-text-secondary">
              Running as <span className="font-medium text-accent">{user?.displayName || user?.userId || 'you'}</span>
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Run as</label>
      <BotPicker selected={selected} onChange={onChange} />
    </div>
  );
}
