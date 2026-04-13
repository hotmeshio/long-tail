import { Bot, UserCircle } from 'lucide-react';
import { BotPicker } from '../../../components/common/form/BotPicker';
import { useAuth } from '../../../hooks/useAuth';
import type { LTWorkflowConfig } from '../../../api/types';

export function IdentitySummary({
  config,
  overrideBot,
  onOverrideChange,
  showOverride,
}: {
  config: LTWorkflowConfig;
  overrideBot?: string;
  onOverrideChange?: (botExternalId: string) => void;
  showOverride?: boolean;
}) {
  const { user } = useAuth();
  const effectiveBot = overrideBot || config.execute_as;

  return (
    <div className="bg-surface-sunken rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">Running as</span>
        {effectiveBot && !overrideBot && (
          <span className="text-[9px] text-text-tertiary">configured default</span>
        )}
        {overrideBot && (
          <span className="text-[9px] text-accent">admin override</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {effectiveBot ? (
          <>
            <Bot className="w-3.5 h-3.5 text-accent/70" />
            <span className="text-xs text-text-primary font-mono">{effectiveBot}</span>
          </>
        ) : (
          <>
            <UserCircle className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-xs text-text-primary">
              {user?.displayName || user?.username || 'you'}
            </span>
          </>
        )}
      </div>
      {showOverride && onOverrideChange && (
        <div className="pt-1 border-t border-surface-border">
          <label className="text-[10px] text-text-tertiary mb-1 block">Override identity</label>
          <BotPicker
            selected={overrideBot ?? ''}
            onChange={onOverrideChange}
            placeholder={config.execute_as ? `Default: ${config.execute_as}` : 'Invoking user (default)'}
          />
        </div>
      )}
    </div>
  );
}
